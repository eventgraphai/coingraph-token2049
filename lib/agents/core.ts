import { z } from "zod";
import { sql } from "../db";
import { BASE_URL, canonical, newId, sha256, type Source } from "../api/respond";

// The agent framework: every CoinGraph agent is one definition (id, purpose, input schema, price tier, run).
// The same definition is served over REST (/v1/agents/{id}), MCP (run_<agent>), the CLI and, for the flagship
// agents, Masumi. Each run is stored with its exact output and SHA-256, so it can be proven and graded.

export type Tier = "premium" | "pro";
export type Reason = { text: string; source: string };

export type AgentOutput = {
  verdict: string;                       // agent-specific, e.g. ALLOW / REDUCE / BLOCK
  summary: string;                       // 1–3 plain sentences for a person
  result: Record<string, unknown>;       // structured answer for software
  reasons: Reason[];                     // why, each with its source
  warnings?: string[];
  links?: Record<string, string>;        // proofs, briefs, pages
  tokens?: string[];                     // coingecko ids involved
  sources?: Source[];
  private?: Record<string, unknown>;     // returned to the caller only; never stored, hashed or shown by /verify (e.g. secrets)
};

export type AgentDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: string;
  name: string;
  tagline: string;
  persona: string[];
  description: string;
  tier: Tier;
  masumi: boolean;                       // registered on Masumi with escrow payment
  verdicts: string[];
  input: S;
  example: z.input<S>;
  run: (input: z.output<S>) => Promise<AgentOutput>;
};

export const defineAgent = <S extends z.ZodTypeAny>(def: AgentDef<S>) => def;

export const AGENT_VERSION = "1.0.0";

export type AgentRun = {
  run_id: string;
  agent: string;
  agent_version: string;
  as_of: string;
  verdict: string;
  summary: string;
  result: Record<string, unknown>;
  reasons: Reason[];
  warnings: string[];
  links: Record<string, string>;
  disclaimer: string;
  hash: string;
  verify_url: string;
};

export async function runAgent(def: AgentDef, rawInput: unknown, opts: { requester?: string; payment?: unknown } = {}): Promise<{ run: AgentRun; sources: Source[] }> {
  const input = def.input.parse(rawInput ?? {});
  const started = Date.now();
  const out = await def.run(input);
  const runId = newId("run");
  const body = {
    run_id: runId,
    agent: def.id,
    agent_version: AGENT_VERSION,
    as_of: new Date().toISOString(),
    verdict: out.verdict,
    summary: out.summary,
    result: out.result,
    reasons: out.reasons,
    warnings: out.warnings ?? [],
    links: out.links ?? {},
    disclaimer: "CoinGraph never trades, holds funds or gives financial advice. The caller decides.",
  };
  const hash = sha256(canonical(body));
  await sql`
    insert into agent_runs (id, agent, version, input, output, verdict, tokens, hash, duration_ms, requester, payment)
    values (${runId}, ${def.id}, ${AGENT_VERSION}, ${sql.json(input as never)}, ${sql.json(body as never)}, ${out.verdict}, ${out.tokens ?? []}, ${hash},
            ${Date.now() - started}, ${opts.requester ?? null}, ${opts.payment ? sql.json(opts.payment as never) : null})`;
  return { run: { ...body, hash, verify_url: `${BASE_URL}/api/v1/verify/${runId}`, ...(out.private ? { private: out.private } : {}) }, sources: out.sources ?? [] };
}

// Small helpers shared by agents.
export const fmtUsd = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `$${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
export const fmtPct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : ""}${Number(v.toFixed(digits))}%`);
export const n = (v: unknown): number | null => (v === null || v === undefined || v === "" || v === "unassessed" || !Number.isFinite(Number(v)) ? null : Number(v));
export const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

export const tokenField = z.string().min(1).max(100).describe("Token: CoinGecko id (chainlink), symbol (LINK) or contract address");
