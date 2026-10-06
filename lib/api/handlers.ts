import { sql } from "../db";
import { investigateNow, MAX_INVESTIGATIONS_PER_HOUR } from "../investigations/runner";
import { ApiError, BASE_URL, cached, fail, newId, ok, options, rateLimit, readJson, resolveToken, withSlot, type Source } from "./respond";
import { buildState, STATE_SECTIONS, type StateSection } from "./state";
import { buildHistory, SERIES, type SeriesName } from "./history";
import { buildMarket, MARKET_SECTIONS, type MarketSection } from "./market";
import { inspectAddress, CHAINS, type Chain } from "./inspect";
import { evaluate, type Policy } from "./evaluate";
import { ask } from "./ask";
import { buildRecord } from "./record";
import { verifyObject } from "./verify";
import { createMonitor, deleteMonitor, listMonitors } from "./monitor";
import { PAYMENT, PRICES, PRICING_NOTES } from "./pricing";
import { loadStatus } from "../status";
import { startWarmer } from "./warm";

startWarmer();

// One function per endpoint. Route files under app/api/v1 only parse the URL and call these.

type Params = Record<string, string>;
const wrap = (fn: (req: Request, params: Params) => Promise<Response>) => async (req: Request, ctx?: { params: Promise<Params> }) => {
  try {
    rateLimit(req);
    return await fn(req, (ctx && (await ctx.params)) ?? {});
  } catch (err) {
    return fail(err);
  }
};
export const OPTIONS = async () => options();

const pick = <T extends string>(raw: string | null, all: readonly T[], name: string): T[] => {
  if (!raw) return [...all];
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean) as T[];
  const bad = list.filter((s) => !all.includes(s));
  if (bad.length) throw new ApiError(400, "invalid_sections", `Unknown ${name}: ${bad.join(", ")}. Valid: ${all.join(", ")}.`);
  return list;
};
const sinceParam = (raw: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "invalid_since", "since must be an ISO-8601 time, e.g. 2026-10-06T00:00:00Z");
  return d;
};

// --- Discover -------------------------------------------------------------------------------------
export const tokens = wrap((req) => cached(req, 30, async () => {
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase().slice(0, 100);
  if (q) {
    const rows = await sql`
      select c.coingecko_id, c.symbol, c.name, (t.coingecko_id is not null and t.in_universe) as tracked, t.market_cap_rank
      from coins c left join tokens t using (coingecko_id)
      where lower(c.symbol) = ${q} or lower(c.name) like ${q + "%"} or c.coingecko_id like ${q + "%"} or exists (select 1 from jsonb_each_text(coalesce(c.platforms, '{}'::jsonb)) p where lower(p.value) = ${q})
      order by tracked desc, t.market_cap_rank nulls last, c.coingecko_id limit 25`;
    return ok("token_list", { query: q, results: rows.map((r) => ({ id: r.coingecko_id, symbol: String(r.symbol).toUpperCase(), name: r.name, tracked: r.tracked, rank: r.market_cap_rank })) }, { sources: [{ provider: "coingecko", endpoint: "/coins/list" }] });
  }
  const rows = await sql`
    with latest as (select distinct on (coingecko_id) coingecko_id, current_price, price_change_percentage_24h, market_cap, total_volume, captured_at,
                      (select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '60 minutes' order by p.captured_at desc limit 1) as p1h
                    from market_snapshots m where captured_at > now() - interval '10 minutes' order by coingecko_id, captured_at desc)
    select t.coingecko_id, t.symbol, t.name, t.market_cap_rank, t.platforms, t.categories, t.is_stablecoin, t.first_seen_at,
           l.current_price, l.price_change_percentage_24h, l.market_cap, l.total_volume, l.captured_at, (l.current_price / nullif(l.p1h, 0) - 1) * 100 as change_1h,
           (select count(*)::int from signals s where s.coingecko_id = t.coingecko_id and s.detected_at > now() - interval '24 hours') as open_signals,
           (select headline from investigations i where i.coingecko_id = t.coingecko_id and i.status = 'done' order by finished_at desc limit 1) as latest_headline
    from tokens t left join latest l using (coingecko_id) where t.in_universe order by t.market_cap_rank`;
  return ok("token_list", {
    count: rows.length,
    tokens: rows.map((r) => ({ id: r.coingecko_id, symbol: String(r.symbol).toUpperCase(), name: r.name, rank: r.market_cap_rank, stablecoin: r.is_stablecoin, chains: Object.fromEntries(Object.entries((r.platforms ?? {}) as Record<string, string>).filter(([, v]) => v)),
      price_usd: r.current_price !== null ? Number(r.current_price) : null, change_1h_pct: r.change_1h !== null ? Math.round(Number(r.change_1h) * 100) / 100 : null, change_24h_pct: r.price_change_percentage_24h !== null ? Math.round(Number(r.price_change_percentage_24h) * 100) / 100 : null,
      market_cap_usd: r.market_cap !== null ? Number(r.market_cap) : null, volume_24h_usd: r.total_volume !== null ? Number(r.total_volume) : null, categories: (r.categories ?? []).slice(0, 5), open_signals: r.open_signals, latest_headline: r.latest_headline, tracked_since: r.first_seen_at, as_of: r.captured_at })),
  }, { as_of: rows[0]?.captured_at, sources: [{ provider: "coingecko", endpoint: "/coins/markets", as_of: rows[0]?.captured_at }, { provider: "coingraph", endpoint: "signals" }] });
}));

export const status = wrap((req) => cached(req, 15, async () => {
  const s = await loadStatus();
  const freshness = Object.fromEntries(s.freshness.map((f) => [f.name, { newest: f.newest, cadence: f.cadence }]));
  const feeds = s.feeds.map((f) => ({ feed: f.feed, status: f.status, last_success_sec_ago: f.age_sec, every_sec: f.every_sec, venues: f.venues }));
  const down = feeds.filter((f) => f.status === "down").length, late = feeds.filter((f) => f.status === "late").length;
  return ok("service_status", {
    pipeline: down ? "degraded" : late ? "late" : "ok", worker_last_beat: s.heartbeats[0]?.last_beat ?? null,
    coverage: { tokens: s.coverage.coingecko.universe, tokens_fresh_10m: s.coverage.coingecko.fresh_10m, candle_series: s.coverage.candles.expected, chains: ["eth", "bsc", "btc", "sol", "ada"], exchanges: ["binance", "binanceusdm", "okx", "coinbase", "bybit", "gate", "kraken"], sources: ["coingecko", "ccxt", "nownodes", "defillama", "rss", "alternative.me"] },
    feeds, freshness,
    budgets: { coingecko_credits_remaining: s.budget.remaining, nownodes_requests_this_month: s.budget.nownodes.usedMonth, nownodes_plan: s.budget.nownodes.plan },
    pricing: { ...PRICING_NOTES, paid_endpoints: PRICES },
    payment: { network: PAYMENT.network, address: PAYMENT.address, facilitator: PAYMENT.facilitator, protocol: "x402" },
    docs: { openapi: `${BASE_URL}/api/v1/openapi.json`, llms: `${BASE_URL}/llms.txt`, api_reference: `${BASE_URL}/docs` },
  }, { as_of: s.now });
}));

// --- Understand -----------------------------------------------------------------------------------
export const state = wrap((req, p) => cached(req, 20, async () => {
  const token = await resolveToken(p.token);
  const sections = pick<StateSection>(new URL(req.url).searchParams.get("sections"), STATE_SECTIONS, "sections");
  const st = await buildState(token, sections);
  return ok("state", { token: st.token, ...st.sections }, { id: newId("st"), as_of: st.as_of ?? undefined, sources: st.sources });
}));

export const history = wrap((req, p) => cached(req, 30, async () => {
  const token = await resolveToken(p.token);
  const url = new URL(req.url);
  const series = pick<SeriesName>(url.searchParams.get("series"), SERIES, "series");
  const h = await buildHistory(token, sinceParam(url.searchParams.get("since")), series);
  return ok("history", { token: h.token, window: h.window, series: h.series, events: h.events }, { id: newId("hs"), sources: h.sources });
}));

export const market = wrap((req) => cached(req, 30, async () => {
  const sections = pick<MarketSection>(new URL(req.url).searchParams.get("sections"), MARKET_SECTIONS, "sections");
  const m = await buildMarket(sections);
  return ok("market", m.sections, { id: newId("mk"), sources: m.sources });
}));

export const inspect = wrap(async (req, p) => {
  // Validate before taking a slot or touching the cache, so bad input never waits behind live lookups.
  if (!CHAINS.includes(p.chain as Chain)) throw new ApiError(400, "invalid_chain", `chain must be one of ${CHAINS.join(", ")}`);
  const address = decodeURIComponent(p.address);
  if ((p.chain === "eth" || p.chain === "bsc") ? !/^0x[0-9a-fA-F]{40}$/.test(address) : !/^[A-Za-z0-9]{20,120}$/.test(address)) throw new ApiError(400, "invalid_address", `Not a valid ${p.chain} address.`);
  return cached(req, 60, () => withSlot("inspect", 6, async () => {
    const r = await inspectAddress(p.chain as Chain, address);
    return ok("address_profile", r.data, { id: newId("ad"), as_of: r.as_of, sources: r.sources });
  }));
});

// --- Decide ---------------------------------------------------------------------------------------
export const evaluateGet = wrap((_req, p) => withSlot("evaluate", 8, async () => {
  const token = await resolveToken(p.token);
  const e = await evaluate(token);
  return ok("evaluation", e.data, { id: e.id, as_of: e.as_of, sources: e.sources });
}));

export const evaluatePost = wrap((req) => withSlot("evaluate", 8, async () => {
  const body = await readJson<{ token?: string; size_usd?: number; policy?: Policy }>(req);
  if (!body.token) throw new ApiError(400, "token_required", "Body must include token.");
  if (body.size_usd !== undefined && (typeof body.size_usd !== "number" || !Number.isFinite(body.size_usd) || body.size_usd <= 0 || body.size_usd > 1e12)) throw new ApiError(400, "invalid_size", "size_usd must be a positive number.");
  if (body.policy !== undefined) {
    const allowed = ["max_unlock_pct", "min_depth_usd", "allow_mint_authority", "max_top10_holder_pct", "max_funding_pct", "max_exchange_inflow_usd"];
    if (typeof body.policy !== "object" || body.policy === null || Array.isArray(body.policy)) throw new ApiError(400, "invalid_policy", "policy must be an object.");
    const unknown = Object.keys(body.policy).filter((k) => !allowed.includes(k));
    if (unknown.length) throw new ApiError(400, "invalid_policy", `Unknown policy rule(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
    for (const [k, v] of Object.entries(body.policy)) if (k !== "allow_mint_authority" ? typeof v !== "number" || !Number.isFinite(v) : typeof v !== "boolean") throw new ApiError(400, "invalid_policy", `policy.${k} has the wrong type.`);
  }
  const token = await resolveToken(body.token);
  const e = await evaluate(token, { size_usd: body.size_usd, policy: body.policy, requester: req.headers.get("x-payment") ? "x402" : undefined });
  return ok("evaluation", e.data, { id: e.id, as_of: e.as_of, sources: e.sources, status: 201 });
}));

const briefSources = (evidence: { items?: { source: string }[] } | null): Source[] => (evidence?.items ?? []).map((e) => ({ provider: e.source.split(":")[0], endpoint: e.source }));
async function briefResponse(row: Record<string, unknown>, token: { coingecko_id: string; symbol: string; name: string }): Promise<Response> {
  const b = row.brief as Record<string, unknown>;
  const data = { token: { id: token.coingecko_id, symbol: token.symbol.toUpperCase(), name: token.name }, id: Number(row.id), headline: row.headline, ...b, window: { from: row.window_from, to: row.window_to }, evidence: (row.evidence as { items?: unknown })?.items ?? [], model: row.model, score: row.score !== null ? Number(row.score) : null, verify_url: `${BASE_URL}/api/v1/verify/${row.id}` };
  return ok("brief", data, { id: String(row.id), as_of: row.finished_at as Date, sources: briefSources(row.evidence as { items?: { source: string }[] } | null) });
}

export const explainGet = wrap(async (_req, p) => {
  const token = await resolveToken(p.token);
  if (p.id !== undefined && !/^\d{1,12}$/.test(p.id)) throw new ApiError(400, "invalid_id", "Brief ids are numbers.");
  const [row] = p.id
    ? await sql`select * from investigations where id = ${Number(p.id)} and coingecko_id = ${token.coingecko_id} and status = 'done'`
    : await sql`select * from investigations where coingecko_id = ${token.coingecko_id} and status = 'done' order by finished_at desc limit 1`;
  if (!row) throw new ApiError(404, "no_brief", p.id ? `No brief ${p.id} for ${token.coingecko_id}.` : `No brief for ${token.coingecko_id} yet. POST /v1/explain with {"token":"${token.coingecko_id}"} to run an investigation (~60s).`);
  return briefResponse(row, token);
});

export const explainPost = wrap((req) => withSlot("explain", 3, async () => {
  const body = await readJson<{ token?: string; hours?: number }>(req);
  if (!body.token) throw new ApiError(400, "token_required", "Body must include token.");
  const token = await resolveToken(body.token);
  const [{ recent }] = await sql<{ recent: number }[]>`select count(*)::int as recent from investigations where started_at > now() - interval '1 hour'`;
  if (recent >= MAX_INVESTIGATIONS_PER_HOUR) throw new ApiError(429, "investigations_busy", `Fresh investigations are limited to ${MAX_INVESTIGATIONS_PER_HOUR} per hour during the hackathon. Use GET /v1/explain/${token.coingecko_id} for the latest brief.`);
  const hours = Math.min(Math.max(Number(body.hours ?? 2), 1), 24);
  const id = await investigateNow(token.coingecko_id, hours, "api");
  const [row] = await sql`select * from investigations where id = ${id}`;
  if (row.status !== "done") throw new ApiError(502, "investigation_failed", String(row.error ?? "investigation failed"));
  return briefResponse(row, token);
}));

export const askPost = wrap((req) => withSlot("ask", 4, async () => {
  const body = await readJson<{ token?: string; question?: string; claim?: string }>(req);
  if (!body.token) throw new ApiError(400, "token_required", "Body must include token.");
  if (!body.question === !body.claim) throw new ApiError(400, "question_or_claim", "Provide exactly one of question or claim.");
  const text = String(body.question ?? body.claim);
  if (typeof (body.question ?? body.claim) !== "string" || text.trim().length < 3 || text.length > 500) throw new ApiError(400, "invalid_text", "question / claim must be a string of 3–500 characters.");
  const token = await resolveToken(body.token);
  const a = await ask(token, { question: body.question, claim: body.claim });
  return ok("answer", a.data, { id: a.id, sources: a.sources, status: 201 });
}));

// --- Watch ----------------------------------------------------------------------------------------
export const monitorPost = wrap(async (req) => ok("monitor", await createMonitor(await readJson(req)), { status: 201 }));
export const monitorGet = wrap(async (req) => ok("monitor_list", { monitors: await listMonitors(req.headers.get("x-monitor-secret")) }));
export const monitorDelete = wrap(async (req, p) => ok("monitor", await deleteMonitor(p.id, req.headers.get("x-monitor-secret"))));

// --- Trust ----------------------------------------------------------------------------------------
export const record = wrap((req, p) => cached(req, 60, async () => {
  const url = new URL(req.url);
  const token = p.token ? (await resolveToken(p.token)).coingecko_id : null;
  const r = await buildRecord(token, sinceParam(url.searchParams.get("since")), url.searchParams.get("kind"));
  return ok("record", r, { sources: [{ provider: "coingraph", endpoint: "evaluations, signals, briefs" }, { provider: "coingecko", endpoint: "/coins/markets" }] });
}));

export const verify = wrap(async (_req, p) => {
  const v = await verifyObject(decodeURIComponent(p.id));
  return ok("proof", v, { id: v.id, as_of: v.issued_at, sources: v.provenance.map((x) => ({ provider: x.provider, endpoint: x.endpoint, as_of: x.at })) });
});
