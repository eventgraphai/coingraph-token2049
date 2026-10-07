import { timingSafeEqual } from "node:crypto";
import { sql } from "../db";
import { ApiError } from "./respond";
import { verifyObject } from "./verify";

// Chainlink CRE attestation of proofs. The workflow in cre/verify-investigation polls GET /v1/attest for
// proofs without an attestation, fetches each one from /v1/verify/{id}, recomputes the SHA-256 on every
// node, reaches consensus and POSTs the result here. Both calls carry the workflow secret (x-cre-key).

export const ATTEST_HEADER = "x-cre-key";
const ID_RE = /^(eval_|ans_|run_)[a-f0-9]{8,40}$|^\d{1,9}$/;

export function attestAuthorised(req: Request): boolean {
  const expected = process.env.CRE_API_KEY ?? "";
  const given = req.headers.get(ATTEST_HEADER) ?? "";
  if (expected.length < 32 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function requireAttestKey(req: Request): void {
  if (!attestAuthorised(req)) throw new ApiError(401, "unauthorized", `This endpoint is for the Chainlink CRE workflow; send the workflow key as ${ATTEST_HEADER}.`);
}

// Proofs issued in the last day that have no attestation yet, newest first. With `ids`, exactly those
// proofs (attested or not), so a workflow run can be pointed at specific answers.
export async function pendingProofs(limit: number, ids: string[] = []): Promise<{ id: string; kind: string; issued_at: Date }[]> {
  const wanted = ids.map((x) => x.trim()).filter((x) => ID_RE.test(x)).slice(0, 50);
  if (wanted.length) {
    const rows = await sql`
      with p as (
        select id, 'evaluation' as kind, created_at as issued_at from evaluations where id = any(${wanted})
        union all select id, 'answer', created_at from answers where id = any(${wanted})
        union all select id, 'agent_run:' || agent, created_at from agent_runs where id = any(${wanted})
        union all select id::text, 'brief', finished_at from investigations where status = 'done' and id::text = any(${wanted})
      )
      select id, kind, issued_at from p`;
    return wanted.flatMap((id) => rows.filter((r) => r.id === id).map((r) => ({ id: r.id, kind: r.kind, issued_at: r.issued_at })));
  }
  const rows = await sql`
    with p as (
      select id, 'evaluation' as kind, created_at as issued_at from evaluations where created_at > now() - interval '24 hours'
      union all select id, 'answer', created_at from answers where created_at > now() - interval '24 hours'
      union all select id, 'agent_run:' || agent, created_at from agent_runs where created_at > now() - interval '24 hours'
      union all select id::text, 'brief', finished_at from investigations where status = 'done' and finished_at > now() - interval '24 hours'
    )
    select p.id, p.kind, p.issued_at from p left join attestations a using (id) where a.id is null order by p.issued_at desc limit ${Math.min(Math.max(limit, 1), 50)}`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, issued_at: r.issued_at }));
}

export type AttestInput = {
  id: string;
  sha256: string;                       // what the workflow computed from the served object
  served_sha256?: string;               // what /v1/verify/{id} said at the time
  workflow?: { name?: string; id?: string; execution_id?: string; mode?: string; node_count?: number; consensus?: string; executed_at?: string };
};

export async function getAttestation(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await sql`select attestation from attestations where id = ${id}`;
  return (row?.attestation as Record<string, unknown>) ?? null;
}

// Store one attestation. The server recomputes the fingerprint itself before accepting it: a workflow
// can only attest what the proof really hashes to, never a fingerprint of its own choosing.
export async function recordAttestation(input: AttestInput): Promise<{ id: string; attestation: Record<string, unknown>; created: boolean }> {
  const id = String(input.id ?? "").trim();
  if (!ID_RE.test(id)) throw new ApiError(400, "invalid_id", "Ids look like eval_…, ans_…, run_… or a brief number.");
  if (!/^[a-f0-9]{64}$/.test(String(input.sha256 ?? ""))) throw new ApiError(400, "invalid_hash", "sha256 must be 64 hex characters.");
  const proof = await verifyObject(id);
  if (proof.sha256 !== input.sha256) throw new ApiError(409, "hash_mismatch", `The fingerprint ${input.sha256} does not match this proof (${proof.sha256}).`, { expected: proof.sha256 });
  const w = input.workflow ?? {};
  const mode = w.mode === "don" ? "don" : "simulation";
  const attestation = {
    status: "attested",
    mode,                                                                   // "simulation": CRE CLI simulator (local DON); "don": a deployed Chainlink DON
    network: "chainlink-cre",
    workflow: { name: String(w.name ?? "verify-investigation").slice(0, 80), id: w.id ? String(w.id).slice(0, 120) : process.env.CRE_WORKFLOW_ID ?? null, execution_id: w.execution_id ? String(w.execution_id).slice(0, 120) : null },
    consensus: { aggregation: String(w.consensus ?? "identical").slice(0, 40), nodes: Number.isFinite(Number(w.node_count)) ? Number(w.node_count) : null },
    sha256: proof.sha256,
    served_sha256: typeof input.served_sha256 === "string" ? input.served_sha256.slice(0, 64) : proof.sha256,
    matches_stored: proof.hash_matches_stored,
    attested_at: w.executed_at && !Number.isNaN(Date.parse(w.executed_at)) ? new Date(w.executed_at).toISOString() : new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    note: mode === "simulation"
      ? "The Chainlink CRE workflow fetched this proof, recomputed the SHA-256 independently and reached consensus on the CRE simulator (a local DON). On-chain publication of the attestation is the next step."
      : "The Chainlink CRE workflow fetched this proof, recomputed the SHA-256 independently and reached DON consensus.",
  };
  const [row] = await sql`
    insert into attestations (id, kind, sha256, attestation) values (${id}, ${proof.kind}, ${proof.sha256}, ${sql.json(attestation as never)})
    on conflict (id) do update set sha256 = excluded.sha256, attestation = excluded.attestation, updated_at = now()
    returning (xmax = 0) as created`;
  return { id, attestation, created: Boolean(row?.created) };
}
