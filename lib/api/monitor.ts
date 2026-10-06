import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { sql } from "../db";
import { ApiError, newId, resolveToken } from "./respond";

// /v1/monitor: watch tokens and receive signed webhooks when something changes. Deliveries are queued by the
// worker (alerts:deliver) and sent with up to 3 attempts.

export type Conditions = { kinds?: string[]; min_severity?: number; verdict_changes?: boolean; new_briefs?: boolean };

// Webhooks only go to public hosts: no localhost, private ranges, link-local/metadata addresses or internal names (SSRF guard).
function isPrivateIp(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped ? mapped[1] : h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return h.includes(":") && (h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:"));
}

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "webhook_url_invalid", "webhook_url is not a valid URL.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedName = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".railway.internal") || !host.includes(".");
  if (blockedName || isPrivateIp(host)) throw new ApiError(400, "webhook_url_not_public", "webhook_url must point to a public host.");
  return url;
}

// The name must also *resolve* only to public addresses (a public-looking name can point at 169.254.x.x or 10.x).
// Checked at creation and again before every delivery, so a later DNS change can't redirect webhooks inward.
export async function assertPublicHost(raw: string): Promise<void> {
  const url = assertPublicUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, "webhook_url_unresolvable", "webhook_url's host does not resolve.");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new ApiError(400, "webhook_url_not_public", "webhook_url must resolve to a public address.");
}

export async function createMonitor(input: { tokens?: string[]; webhook_url?: string; conditions?: Conditions }) {
  if (!Array.isArray(input.tokens) || !input.tokens.length) throw new ApiError(400, "tokens_required", "Provide tokens: [\"bitcoin\", …].");
  if (input.tokens.length > 50) throw new ApiError(400, "too_many_tokens", "A monitor can watch up to 50 tokens.");
  if (!input.webhook_url || !/^https:\/\//.test(input.webhook_url) || input.webhook_url.length > 2000) throw new ApiError(400, "webhook_url_required", "webhook_url must be an https URL.");
  assertPublicUrl(input.webhook_url); // cheap syntactic check first
  const tokens = [];
  for (const t of input.tokens) tokens.push((await resolveToken(t)).coingecko_id);
  await assertPublicHost(input.webhook_url); // then DNS: the host must resolve only to public addresses
  const conditions: Conditions = { kinds: input.conditions?.kinds, min_severity: input.conditions?.min_severity ?? 2, verdict_changes: input.conditions?.verdict_changes ?? true, new_briefs: input.conditions?.new_briefs ?? true };
  const id = newId("mon");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  await sql`insert into monitors (id, tokens, conditions, webhook_url, secret) values (${id}, ${tokens}, ${sql.json(conditions as never)}, ${input.webhook_url}, ${secret})`;
  return { id, secret, tokens, conditions, webhook_url: input.webhook_url, created_at: new Date().toISOString(), note: "Keep the secret: it is shown once and used to sign every webhook (X-CoinGraph-Signature = HMAC-SHA256 of the body)." };
}

export async function listMonitors(secret: string | null) {
  if (!secret) throw new ApiError(401, "secret_required", "Send your monitor secret in the X-Monitor-Secret header.");
  const rows = await sql`select id, tokens, conditions, webhook_url, active, created_at, last_delivered_at from monitors where secret = ${secret}`;
  return rows.map((r) => ({ id: r.id, tokens: r.tokens, conditions: r.conditions, webhook_url: r.webhook_url, active: r.active, created_at: r.created_at, last_delivered_at: r.last_delivered_at }));
}

export async function deleteMonitor(id: string, secret: string | null) {
  if (!secret) throw new ApiError(401, "secret_required", "Send your monitor secret in the X-Monitor-Secret header.");
  const res = await sql`update monitors set active = false where id = ${id} and secret = ${secret} and active`;
  if (!res.count) throw new ApiError(404, "not_found", "No active monitor with that id and secret.");
  return { id, active: false };
}

// Worker job: queue new signals / briefs for watched tokens, then deliver pending webhooks.
export async function deliverAlerts(): Promise<number> {
  const monitors = await sql`select id, tokens, conditions, webhook_url, secret, created_at from monitors where active`;
  let queued = 0;
  for (const m of monitors) {
    const c = (m.conditions ?? {}) as Conditions;
    const sigs = await sql`
      select s.id, s.coingecko_id, s.kind, s.direction, s.severity, s.value, s.ratio, s.event_ts, s.details from signals s
      where s.coingecko_id = any(${m.tokens}) and s.detected_at > greatest(${m.created_at}, now() - interval '2 hours') and s.severity >= ${c.min_severity ?? 2}
        ${c.kinds?.length ? sql`and s.kind = any(${c.kinds})` : sql``}
        and not exists (select 1 from alert_deliveries d where d.monitor_id = ${m.id} and d.kind = 'signal' and d.ref_id = s.id::text)`;
    for (const s of sigs) {
      await sql`insert into alert_deliveries (monitor_id, kind, ref_id, coingecko_id, payload) values (${m.id}, 'signal', ${String(s.id)}, ${s.coingecko_id}, ${sql.json({ monitor_id: m.id, kind: "signal", token: s.coingecko_id, object: { id: s.id, kind: s.kind, direction: s.direction, severity: s.severity, value: s.value, ratio: s.ratio, at: s.event_ts, details: s.details }, as_of: new Date().toISOString() } as never)}) on conflict do nothing`;
      queued++;
    }
    if (c.new_briefs !== false) {
      const briefs = await sql`
        select i.id, i.coingecko_id, i.headline, i.brief->>'direction' as direction, i.brief->>'severity' as severity, i.brief->>'summary' as summary, i.finished_at from investigations i
        where i.coingecko_id = any(${m.tokens}) and i.status = 'done' and i.finished_at > greatest(${m.created_at}, now() - interval '2 hours')
          and not exists (select 1 from alert_deliveries d where d.monitor_id = ${m.id} and d.kind = 'brief' and d.ref_id = i.id::text)`;
      for (const b of briefs) {
        await sql`insert into alert_deliveries (monitor_id, kind, ref_id, coingecko_id, payload) values (${m.id}, 'brief', ${String(b.id)}, ${b.coingecko_id}, ${sql.json({ monitor_id: m.id, kind: "brief", token: b.coingecko_id, object: { id: b.id, headline: b.headline, direction: b.direction, severity: Number(b.severity), summary: b.summary, url: `/v1/explain/${b.coingecko_id}/${b.id}` }, as_of: new Date().toISOString() } as never)}) on conflict do nothing`;
        queued++;
      }
    }
  }
  const pending = await sql`select d.id, d.payload, d.attempts, m.webhook_url, m.secret from alert_deliveries d join monitors m on m.id = d.monitor_id where d.status = 'pending' and d.attempts < 3 order by d.created_at limit 50`;
  let delivered = 0;
  for (const d of pending) {
    const body = JSON.stringify(d.payload);
    const sig = createHmac("sha256", d.secret).update(body).digest("hex");
    try {
      await assertPublicHost(d.webhook_url); // re-check: DNS may have changed since the monitor was created
      // Redirects are not followed: a public endpoint must not be able to bounce the request to an internal one.
      const res = await fetch(d.webhook_url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", "x-coingraph-signature": sig, "user-agent": "CoinGraph-Webhooks/1.0" }, body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(res.status >= 300 && res.status < 400 ? `redirect (${res.status}) not followed` : `HTTP ${res.status}`);
      await sql`update alert_deliveries set status = 'delivered', delivered_at = now(), attempts = attempts + 1 where id = ${d.id}`;
      await sql`update monitors set last_delivered_at = now() where id = (select monitor_id from alert_deliveries where id = ${d.id})`;
      delivered++;
    } catch (err) {
      const attempts = Number(d.attempts) + 1;
      await sql`update alert_deliveries set attempts = ${attempts}, last_error = ${(err as Error).message.slice(0, 300)}, status = ${attempts >= 3 ? "failed" : "pending"} where id = ${d.id}`;
    }
  }
  return queued + delivered;
}
