import { sql } from "../db";
import { buildRecord } from "../api/record";

// Live numbers for the public website. Every value comes from the database at request time and is
// memoised for a minute, so the homepage never shows a number this build cannot back up.

const memo = new Map<string, { at: number; value: Promise<unknown> }>();
function remember<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T | null>;
  const value = fn().catch((e) => { console.error(`[site] ${key}:`, e instanceof Error ? e.message : e); memo.delete(key); return null; });
  memo.set(key, { at: Date.now(), value });
  return value;
}

export type SiteStats = {
  tokens: number; venues: number; chains: number; rows: number;
  signals24h: number; briefs: number; checks: number; agentRuns: number; transfers: number;
  calls: number | null; graded: number | null; hitRate: number | null;
  byKind: Record<string, { graded: number; right: number; hit_rate_pct: number | null }> | null;
};

export const getStats = () => remember<SiteStats>("stats", 60_000, async () => {
  const [[c], [r], [rec]] = await Promise.all([
    sql`select
      (select count(*) from tokens where in_universe)::int as tokens,
      (select count(distinct venue) from symbol_map where is_primary)::int as venues,
      (select count(*) from signals where detected_at > now() - interval '24 hours')::int as signals24h,
      (select count(*) from investigations where status = 'done')::int as briefs,
      ((select count(*) from evaluations) + (select count(*) from answers) + (select count(*) from agent_runs))::int as checks,
      (select count(*) from agent_runs)::int as agent_runs,
      (select count(*) from onchain_transfers)::int as transfers`,
    sql`select coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint as rows from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    buildRecord(null, null, null).then((x) => [x.calibration]).catch(() => [null]),
  ]);
  return {
    tokens: c.tokens, venues: c.venues, chains: 5, rows: Number(r.rows),
    signals24h: c.signals24h, briefs: c.briefs, checks: c.checks, agentRuns: c.agent_runs, transfers: c.transfers,
    calls: rec?.total_calls ?? null, graded: rec?.graded ?? null, hitRate: rec?.hit_rate_pct ?? null, byKind: rec?.by_kind ?? null,
  };
});

export type Reason = { text: string; source: string; info?: boolean };
export type Example = {
  id: string; token: string; symbol: string; name: string; verdict: string; confidence: number | null; at: Date;
  dimensions: { key: string; rating: string; reasons: Reason[] }[]; reasons: (Reason & { dimension?: string })[];
};

// The most informative recent check: among each token's latest check (last two days), the one with the most flagged dimensions.
export const getExample = () => remember<Example | null>("example", 120_000, async () => {
  const [e] = await sql`
    with latest as (
      select distinct on (coingecko_id) * from evaluations
      where created_at > now() - interval '48 hours' order by coingecko_id, created_at desc)
    select e.id, e.coingecko_id, e.verdict, e.created_at, e.snapshot, t.symbol, t.name,
           (select count(*) from jsonb_each(e.snapshot->'dimensions') d where d.value->>'rating' in ('caution', 'avoid')) as flagged
    from latest e join tokens t using (coingecko_id)
    where e.verdict in ('caution', 'avoid')
    order by flagged desc, e.created_at desc limit 1`;
  if (!e) return null;
  const s = e.snapshot as { confidence?: number; dimensions: Record<string, { rating: string; reasons: Reason[] }>; reasons: (Reason & { dimension?: string })[] };
  const order = ["momentum", "liquidity", "leverage", "onchain", "supply", "contract", "context"];
  return {
    id: e.id, token: e.coingecko_id, symbol: String(e.symbol).toUpperCase(), name: e.name, verdict: e.verdict, confidence: s.confidence ?? null, at: e.created_at,
    dimensions: order.filter((k) => s.dimensions?.[k]).map((k) => ({ key: k, rating: s.dimensions[k].rating, reasons: s.dimensions[k].reasons ?? [] })),
    reasons: s.reasons ?? [],
  };
}) as Promise<Example | null>;

export type FeedItem = { id: number; symbol: string; kind: string; direction: string; severity: number; at: Date; brief: string | null; briefId: number | null };

export const getFeed = () => remember<FeedItem[]>("feed", 30_000, async () => {
  const rows = await sql`
    select s.id, upper(coalesce(t.symbol, 'market')) as symbol, s.kind, s.direction, s.severity, s.detected_at, i.headline, i.id as brief_id
    from signals s left join tokens t using (coingecko_id) left join investigations i on i.id = s.investigation_id and i.status = 'done'
    where s.severity >= 2 order by s.detected_at desc limit 7`;
  return rows.map((r) => ({ id: Number(r.id), symbol: r.symbol, kind: r.kind, direction: r.direction, severity: r.severity, at: r.detected_at, brief: r.headline, briefId: r.brief_id }));
});

export type LatestBrief = { id: number; symbol: string; headline: string; at: Date };
export const getLatestBrief = () => remember<LatestBrief | null>("brief", 60_000, async () => {
  const [b] = await sql`select i.id, upper(t.symbol) as symbol, i.headline, i.finished_at from investigations i join tokens t using (coingecko_id) where i.status = 'done' and i.headline is not null order by i.finished_at desc limit 1`;
  return b ? { id: Number(b.id), symbol: b.symbol, headline: b.headline, at: b.finished_at } : null;
}) as Promise<LatestBrief | null>;

export const SIGNAL_LABEL: Record<string, string> = {
  price_move: "Price move", volume_spike: "Volume spike", oi_change: "Open interest jump", funding_extreme: "Funding extreme",
  liquidation_cluster: "Liquidation cluster", exchange_inflow: "Exchange inflow", exchange_outflow: "Exchange outflow",
  whale_transfer: "Whale transfer", stablecoin_exchange_inflow: "Stablecoins to exchanges", positioning_extreme: "Crowded positioning",
  news_burst: "News burst", tvl_drop: "TVL drop",
};

export function ago(d: Date | string, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

export const compact = (v: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export type Coverage = { top: { symbol: string; name: string; rank: number | null; stablecoin: boolean }[]; total: number; stablecoins: number; chains: string[]; venues: string[]; categories: { name: string; n: number }[] };

// What CoinGraph covers, read live: the tracked universe by market-cap rank, the chains read on chain, the exchanges
// read for order books and futures, and the most common categories.
export const getCoverage = () => remember<Coverage>("coverage", 300_000, async () => {
  const [tokens, chains, venues] = await Promise.all([
    sql`select upper(symbol) as symbol, name, market_cap_rank, is_stablecoin, coalesce(categories, '{}') as categories from tokens where in_universe order by market_cap_rank nulls last`,
    sql`select distinct chain from onchain_contracts order by 1`,
    sql`select venue, count(*)::int as n from symbol_map where is_primary group by 1 order by 2 desc`,
  ]);
  const cats = new Map<string, number>();
  for (const t of tokens) for (const c of t.categories as string[]) if (!/index|made in usa|ecosystem/i.test(c)) cats.set(c, (cats.get(c) ?? 0) + 1);
  return {
    top: tokens.map((t) => ({ symbol: t.symbol, name: t.name, rank: t.market_cap_rank, stablecoin: t.is_stablecoin })),
    total: tokens.length, stablecoins: tokens.filter((t) => t.is_stablecoin).length,
    chains: ["eth", "bsc", "btc", "sol", "ada"].filter((c) => c === "btc" || chains.some((x) => x.chain === c)),
    venues: venues.map((v) => String(v.venue).replace("binanceusdm", "binance futures")),
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n })),
  };
});
