import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db";

// Shared pieces of the CoinGraph API: the response envelope, errors, ids, canonical hashing,
// token resolution, CORS and a simple per-IP rate limit.

export const API_VERSION = "v1";
export const BASE_URL = process.env.COINGRAPH_PUBLIC_URL ?? "https://token2049.coingraph.ai";

export type Source = { provider: string; endpoint?: string; as_of?: string | Date | null };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-payment, x-monitor-secret",
  "access-control-expose-headers": "x-request-id, x-payment-required",
};

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

// Deterministic JSON (sorted keys) so the same object always hashes the same.
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v instanceof Date ? v.toISOString() : v;
  };
  return JSON.stringify(sort(value));
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function ok(object: string, data: unknown, opts: { id?: string; as_of?: Date | string; sources?: Source[]; status?: number; headers?: Record<string, string> } = {}): Response {
  const body = {
    object,
    id: opts.id ?? null,
    as_of: opts.as_of ? new Date(opts.as_of).toISOString() : new Date().toISOString(),
    data,
    sources: dedupeSources(opts.sources ?? []),
  };
  return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...(opts.headers ?? {}) } });
}

export function fail(err: unknown): Response {
  const e = err instanceof ApiError ? err : new ApiError(500, "internal_error", (err as Error)?.message?.slice(0, 300) ?? "unexpected error");
  if (e.status >= 500) console.error("[api]", err);
  return new Response(JSON.stringify({ error: { code: e.code, message: e.message, ...(e.extra ?? {}) } }), {
    status: e.status, headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export function options(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of sources) {
    const key = `${s.provider}|${s.endpoint ?? ""}`;
    const prev = seen.get(key);
    const asOf = s.as_of ? new Date(s.as_of) : null;
    if (!prev || (asOf && (!prev.as_of || asOf > new Date(prev.as_of)))) seen.set(key, { provider: s.provider, endpoint: s.endpoint, as_of: asOf ? asOf.toISOString() : null });
  }
  return [...seen.values()];
}

// Resolve a token id, symbol or contract address to a tracked coingecko_id.
export type Token = { coingecko_id: string; symbol: string; name: string; market_cap_rank: number | null; is_stablecoin: boolean; is_demo: boolean };
export async function resolveToken(input: string): Promise<Token> {
  const raw = decodeURIComponent(input ?? "").trim();
  if (!raw) throw new ApiError(400, "token_required", "Provide a token id, symbol or contract address.");
  const key = raw.toLowerCase();
  const rows = await sql<Token[]>`
    select coingecko_id, symbol, name, market_cap_rank, is_stablecoin, is_demo from tokens
    where in_universe and (
      coingecko_id = ${key}
      or lower(symbol) = ${key}
      or exists (select 1 from jsonb_each_text(coalesce(platforms, '{}'::jsonb)) p where lower(p.value) = ${key})
    )
    order by case when coingecko_id = ${key} then 0 when lower(symbol) = ${key} then 1 else 2 end, market_cap_rank nulls last
    limit 1`;
  if (!rows[0]) throw new ApiError(404, "token_not_found", `"${raw}" is not in the tracked universe. Use GET /v1/tokens?q=${encodeURIComponent(raw)} to search.`);
  return rows[0];
}

// Body parsing with a clear error.
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON.");
  }
}

// Per-IP rate limit (free tier). In-memory, per process: enough for a single service.
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(req: Request, perMinute = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 60)): void {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + 60_000 });
    return;
  }
  b.count++;
  if (b.count > perMinute) throw new ApiError(429, "rate_limited", `Free use is limited to ${perMinute} requests per minute. Try again in ${Math.ceil((b.reset - now) / 1000)}s.`);
}

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const pctChange = (now: number | null, then: number | null) => (now !== null && then !== null && then !== 0 ? Math.round(((now / then - 1) * 10000)) / 100 : null);
export const round = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

// Section helper: every section carries its own as_of and sources.
export type Section<T> = T & { as_of: string | null; sources: Source[] };
export function section<T extends object>(data: T, asOf: Date | string | null | undefined, sources: Source[]): Section<T> {
  return { ...data, as_of: asOf ? new Date(asOf).toISOString() : null, sources: dedupeSources(sources) };
}
