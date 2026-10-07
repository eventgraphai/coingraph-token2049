import { consensusIdenticalAggregation, CronCapability, handler, HTTPClient, json, ok, Runner, type HTTPSendRequester, type Runtime } from "@chainlink/cre-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// CoinGraph proof attestation on Chainlink CRE.
//
// Every answer CoinGraph issues is stored exactly as issued and fingerprinted (SHA-256 of canonical JSON).
// This workflow is the independent witness: on a schedule it asks CoinGraph which proofs still lack an
// attestation, fetches each proof from the public /v1/verify/{id} endpoint, recomputes the fingerprint on
// every node, requires the nodes to agree (identical consensus), and posts the attestation back. CoinGraph
// re-hashes before storing it, so neither side can attest a fingerprint the object does not hash to.

export type Config = {
  schedule: string;
  baseUrl: string;        // CoinGraph API origin, e.g. https://token2049.coingraph.ai
  batch: number;          // proofs attested per run
  workflowName: string;
  mode: "simulation" | "don";
};

export type PendingProof = { id: string; kind: string };
export type ProofCheck = { id: string; kind: string; sha256: string; served_sha256: string; matches_served: boolean; stored: "match" | "mismatch" | "unknown" };

const SECRET_ID = "COINGRAPH_ATTEST_KEY";
const KEY_HEADER = "x-cre-key";

// Canonical JSON exactly as lib/api/respond.ts writes it: keys sorted at every level, no whitespace.
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
};

export const fingerprint = (canon: string): string => bytesToHex(sha256(new TextEncoder().encode(canon)));

const headers = (key: string) => ({ [KEY_HEADER]: { values: [key] }, "content-type": { values: ["application/json"] }, "user-agent": { values: ["coingraph-cre/verify-investigation"] } });

// Node mode: every node asks CoinGraph for the queue; consensus requires the same list back.
const fetchPending = (r: HTTPSendRequester, cfg: Config, key: string): PendingProof[] => {
  const res = r.sendRequest({ url: `${cfg.baseUrl}/api/v1/attest?limit=${cfg.batch}`, method: "GET", multiHeaders: headers(key) }).result();
  if (!ok(res)) throw new Error(`attest queue failed: HTTP ${res.statusCode}`);
  const body = json(res) as { data?: { proofs?: { id: string; kind: string }[] } };
  return (body.data?.proofs ?? []).map((p) => ({ id: p.id, kind: p.kind }));
};

// Node mode: every node fetches the proof itself and recomputes the fingerprint from the served object.
const checkProof = (r: HTTPSendRequester, cfg: Config, id: string): ProofCheck => {
  const res = r.sendRequest({ url: `${cfg.baseUrl}/api/v1/verify/${encodeURIComponent(id)}`, method: "GET" }).result();
  if (!ok(res)) throw new Error(`verify ${id} failed: HTTP ${res.statusCode}`);
  const body = json(res) as { data?: { kind?: string; sha256?: string; hash_matches_stored?: boolean | null; object?: unknown } };
  const d = body.data ?? {};
  const computed = fingerprint(canonical(d.object));
  return { id, kind: String(d.kind ?? ""), sha256: computed, served_sha256: String(d.sha256 ?? ""), matches_served: computed === d.sha256, stored: d.hash_matches_stored === true ? "match" : d.hash_matches_stored === false ? "mismatch" : "unknown" };
};

// Node mode: post the agreed attestations. The endpoint upserts by id, so every node posting is harmless.
const postAttestations = (r: HTTPSendRequester, cfg: Config, key: string, proofs: ProofCheck[], executedAt: string): { attested: number; rejected: number } => {
  const body = JSON.stringify({ proofs, workflow: { name: cfg.workflowName, mode: cfg.mode, consensus: "identical", executed_at: executedAt } });
  const res = r.sendRequest({ url: `${cfg.baseUrl}/api/v1/attest`, method: "POST", multiHeaders: headers(key), body: bytesToBase64(new TextEncoder().encode(body)) }).result();
  if (!ok(res)) throw new Error(`attest post failed: HTTP ${res.statusCode}`);
  const out = json(res) as { data?: { attested?: number; rejected?: number } };
  return { attested: Number(out.data?.attested ?? 0), rejected: Number(out.data?.rejected ?? 0) };
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (b === undefined ? "=" : alphabet[(n >> 6) & 63]) + (c === undefined ? "=" : alphabet[n & 63]);
  }
  return out;
};

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const key = runtime.getSecret({ id: SECRET_ID }).result().value;
  const http = new HTTPClient();
  const executedAt = runtime.now().toISOString();

  const pending = http.sendRequest(runtime, fetchPending, consensusIdenticalAggregation<PendingProof[]>())(cfg, key).result();
  runtime.log(`${pending.length} proof(s) waiting for attestation`);
  if (!pending.length) return "nothing to attest";

  const checks: ProofCheck[] = [];
  for (const p of pending) {
    const c = http.sendRequest(runtime, checkProof, consensusIdenticalAggregation<ProofCheck>())(cfg, p.id).result();
    runtime.log(`${c.id} (${c.kind}) sha256=${c.sha256} served=${c.matches_served ? "match" : "MISMATCH"} stored=${c.stored}`);
    if (c.matches_served) checks.push(c);
  }
  if (!checks.length) return `0 of ${pending.length} proofs matched; nothing attested`;

  const result = http.sendRequest(runtime, postAttestations, consensusIdenticalAggregation<{ attested: number; rejected: number }>())(cfg, key, checks, executedAt).result();
  const summary = `attested ${result.attested} of ${pending.length} proof(s) (${result.rejected} rejected) at ${executedAt}`;
  runtime.log(summary);
  return summary;
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
