import { sql } from "../db";
import { ApiError, canonical, sha256 } from "./respond";

// GET /v1/verify/{id}: the canonical object, its hash, the Chainlink attestation (when present) and the
// source calls behind it.

export async function verifyObject(id: string) {
  let kind: string, token: string, issuedAt: Date, object: unknown, storedHash: string | null = null, windowFrom: Date, attestation: unknown = null;
  if (id.startsWith("eval_")) {
    const [e] = await sql`select * from evaluations where id = ${id}`;
    if (!e) throw new ApiError(404, "not_found", `No evaluation ${id}`);
    kind = "evaluation"; token = e.coingecko_id; issuedAt = e.created_at; storedHash = e.hash; windowFrom = new Date(new Date(e.created_at).getTime() - 2 * 3600_000);
    object = e.snapshot; // the exact object that was hashed at issue time
  } else if (id.startsWith("ans_")) {
    const [a] = await sql`select * from answers where id = ${id}`;
    if (!a) throw new ApiError(404, "not_found", `No answer ${id}`);
    kind = "answer"; token = a.coingecko_id; issuedAt = a.created_at; storedHash = a.hash; windowFrom = new Date(new Date(a.created_at).getTime() - 4 * 3600_000);
    object = a.evidence; // the exact object that was hashed at issue time
  } else if (id.startsWith("run_")) {
    const [r] = await sql`select * from agent_runs where id = ${id}`;
    if (!r) throw new ApiError(404, "not_found", `No agent run ${id}`);
    kind = `agent_run:${r.agent}`; token = (r.tokens as string[])[0] ?? ""; issuedAt = r.created_at; storedHash = r.hash; windowFrom = new Date(new Date(r.created_at).getTime() - 2 * 3600_000);
    object = r.output; // the exact object that was hashed at issue time
  } else if (/^\d+$/.test(id)) {
    const [b] = await sql`select * from investigations where id = ${Number(id)} and status = 'done'`;
    if (!b) throw new ApiError(404, "not_found", `No brief ${id}`);
    kind = "brief"; token = b.coingecko_id; issuedAt = b.finished_at; windowFrom = b.window_from; attestation = (b.verification as Record<string, unknown>)?.attestation ?? null;
    object = { id: b.id, token: { id: b.coingecko_id }, headline: b.headline, brief: b.brief, evidence: b.evidence, model: b.model };
  } else throw new ApiError(400, "invalid_id", "Ids look like eval_…, ans_…, run_… or a brief number.");

  const canon = canonical(object);
  const hash = sha256(canon);
  const provenance = await sql`
    select id, provider, endpoint, started_at, latency_ms, ok, row_count from api_calls
    where started_at between ${windowFrom} and ${issuedAt} and (params->>'coin' = ${token} or params->>'wallet' is not null and provider = 'nownodes' or endpoint in ('/coins/markets', 'klines:1m', 'fetchFundingRates', 'openInterestHist:5m', 'futuresSentiment:5m', 'eth:eth_getLogs', 'bsc:eth_getLogs'))
    order by started_at desc limit 60`;
  return {
    id, kind, token, issued_at: issuedAt, sha256: hash, hash_matches_stored: storedHash ? storedHash === hash : null, canonical_bytes: Buffer.byteLength(canon),
    attestation: attestation ?? { status: "pending", note: "Chainlink CRE attestation is written after the workflow runs; until then the hash above is the commitment." },
    object,
    provenance: provenance.map((p) => ({ call_id: Number(p.id), provider: p.provider, endpoint: p.endpoint, at: p.started_at, latency_ms: p.latency_ms, ok: p.ok, rows: p.row_count })),
  };
}
