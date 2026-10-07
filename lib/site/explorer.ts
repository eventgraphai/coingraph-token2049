import { sql } from "../db";

// Data for the token explorer list: one row per tracked token with market, verdict, risk and activity columns,
// plus a 7-day hourly sparkline. A handful of set-based queries instead of 100 state calls.

export type TokenRow = {
  id: string; symbol: string; name: string; image: string | null; rank: number | null; stablecoin: boolean; categories: string[];
  price: number | null; change_1h: number | null; change_24h: number | null; change_7d: number | null; market_cap: number | null; volume_24h: number | null;
  verdict: string | null; flagged: string[]; checked_at: Date | null; eval_id: string | null;
  signals_24h: number; max_severity: number; brief_headline: string | null; brief_id: number | null;
  funding_pct: number | null; oi_usd: number | null; net_flow_24h: number | null; chain: string | null;
  risk_level: string | null; top10_pct: number | null; spark: [number, number][];
};

export async function listTokens(): Promise<TokenRow[]> {
  const [rows, sparks] = await Promise.all([
    sql`
      with t as (select coingecko_id, symbol, name, image, market_cap_rank, is_stablecoin, coalesce(categories, '{}') as categories from tokens where in_universe),
      m as (select distinct on (coingecko_id) coingecko_id, current_price, pct_change_1h, pct_change_24h, pct_change_7d, market_cap, total_volume, captured_at
            from market_snapshots where captured_at > now() - interval '2 hours' order by coingecko_id, captured_at desc),
      e as (select distinct on (coingecko_id) coingecko_id, id, verdict, dimensions, created_at from evaluations where created_at > now() - interval '48 hours' order by coingecko_id, created_at desc),
      s as (select coingecko_id, count(*)::int as n, max(severity)::int as sev from signals where detected_at > now() - interval '24 hours' group by 1),
      b as (select distinct on (coingecko_id) coingecko_id, id, headline from investigations where status = 'done' and headline is not null order by coingecko_id, finished_at desc),
      f as (select distinct on (coingecko_id) coingecko_id, funding_rate from funding_rate_snapshots where venue = 'binanceusdm' and captured_at > now() - interval '2 hours' order by coingecko_id, captured_at desc),
      oi as (select coingecko_id, sum(open_interest_value)::float as usd from (select distinct on (coingecko_id, venue) coingecko_id, venue, open_interest_value from open_interest_snapshots where captured_at > now() - interval '2 hours' order by coingecko_id, venue, captured_at desc) x group by 1),
      fl as (select coingecko_id, max(chain) as chain, sum(exchange_net_usd)::float as net from onchain_flow_snapshots where window_start > now() - interval '24 hours' group by 1),
      sec as (select distinct on (coingecko_id) coingecko_id, risk_level, top10_holders_pct from token_security_snapshots order by coingecko_id, captured_at desc),
      h as (select distinct on (coingecko_id) coingecko_id, top10_pct from token_holder_snapshots order by coingecko_id, captured_at desc)
      select t.*, m.current_price, m.pct_change_1h, m.pct_change_24h, m.pct_change_7d, m.market_cap, m.total_volume,
             e.id as eval_id, e.verdict, e.dimensions, e.created_at as checked_at,
             coalesce(s.n, 0) as signals_24h, coalesce(s.sev, 0) as max_severity, b.headline as brief_headline, b.id as brief_id,
             f.funding_rate, oi.usd as oi_usd, fl.net as net_flow_24h, fl.chain, sec.risk_level, coalesce(h.top10_pct, sec.top10_holders_pct) as top10_pct
      from t left join m using (coingecko_id) left join e using (coingecko_id) left join s using (coingecko_id) left join b using (coingecko_id)
             left join f using (coingecko_id) left join oi using (coingecko_id) left join fl using (coingecko_id) left join sec using (coingecko_id) left join h using (coingecko_id)
      order by t.market_cap_rank nulls last`,
    sql`
      select coingecko_id, ts as t, price::float as p from market_chart_points
      where granularity = 'hourly' and ts > now() - interval '7 days' and coingecko_id in (select coingecko_id from tokens where in_universe)
      order by 1, 2`,
  ]);
  const sparkBy = new Map<string, [number, number][]>();
  for (const s of sparks) { const arr = sparkBy.get(s.coingecko_id) ?? []; arr.push([new Date(s.t).getTime(), s.p]); sparkBy.set(s.coingecko_id, arr); }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => {
    const dims = (r.dimensions ?? {}) as Record<string, { rating?: string }>;
    return {
      id: r.coingecko_id, symbol: String(r.symbol).toUpperCase(), name: r.name, image: typeof r.image === "string" ? r.image : (r.image as { small?: string; thumb?: string } | null)?.small ?? (r.image as { thumb?: string } | null)?.thumb ?? null, rank: r.market_cap_rank, stablecoin: r.is_stablecoin, categories: (r.categories as string[]).filter((c) => !/index|made in usa|ecosystem/i.test(c)).slice(0, 2),
      price: n(r.current_price), change_1h: n(r.pct_change_1h), change_24h: n(r.pct_change_24h), change_7d: n(r.pct_change_7d), market_cap: n(r.market_cap), volume_24h: n(r.total_volume),
      verdict: r.verdict ?? null, flagged: Object.entries(dims).filter(([, v]) => v?.rating && v.rating !== "ok" && v.rating !== "unassessed").map(([k]) => k), checked_at: r.checked_at ?? null, eval_id: r.eval_id ?? null,
      signals_24h: Number(r.signals_24h), max_severity: Number(r.max_severity), brief_headline: r.brief_headline ?? null, brief_id: r.brief_id != null ? Number(r.brief_id) : null,
      funding_pct: r.funding_rate != null ? Number(r.funding_rate) * 100 : null, oi_usd: n(r.oi_usd), net_flow_24h: n(r.net_flow_24h), chain: r.chain ?? null,
      risk_level: r.risk_level ?? null, top10_pct: n(r.top10_pct), spark: sparkBy.get(r.coingecko_id) ?? [],
    };
  });
}
