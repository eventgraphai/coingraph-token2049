import { sql } from "../db";
import { num, round, section, type Source } from "./respond";

// GET /v1/market: the whole market at a glance.

export const MARKET_SECTIONS = ["overview", "sectors", "breadth", "sentiment", "flows", "chains", "venues", "rankings", "events", "pulse"] as const;
export type MarketSection = (typeof MARKET_SECTIONS)[number];
const compact = (v: number | null) => (v === null ? null : Number(v.toPrecision(6)));

export async function buildMarket(sections: MarketSection[] = [...MARKET_SECTIONS]) {
  const want = new Set(sections);
  const out: Record<string, unknown> = {};
  const tasks: Promise<void>[] = [];
  const run = (name: MarketSection, fn: () => Promise<unknown>) => {
    if (want.has(name)) tasks.push(fn().then((v) => { out[name] = v; }).catch((err) => { out[name] = { error: (err as Error).message.slice(0, 200), as_of: null, sources: [] }; }));
  };

  run("overview", async () => {
    const [g] = await sql`select * from global_snapshots order by captured_at desc limit 1`;
    if (!g) return section({ status: "unassessed" }, null, []);
    const mc = (g.market_cap_percentage ?? {}) as Record<string, number>;
    return section({
      total_market_cap_usd: compact(num(g.total_market_cap_usd)), total_volume_24h_usd: compact(num(g.total_volume_usd)),
      market_cap_change_24h_pct: round(num(g.market_cap_change_percentage_24h_usd)), volume_change_24h_pct: round(num(g.volume_change_percentage_24h_usd)),
      btc_dominance_pct: round(num(g.btc_dominance)), eth_dominance_pct: round(num(g.eth_dominance)), dominance: Object.fromEntries(Object.entries(mc).slice(0, 10).map(([k, v]) => [k, round(v)])),
      active_cryptocurrencies: g.active_cryptocurrencies, markets: g.markets,
    }, g.captured_at, [{ provider: "coingecko", endpoint: "/global", as_of: g.captured_at }]);
  });

  run("sectors", async () => {
    const rows = await sql`select c.category_id, k.name, c.market_cap, c.market_cap_change_24h, c.volume_24h, c.top_3_coins_id, c.captured_at from category_snapshots c join categories k on k.id = c.category_id
      where c.captured_at = (select max(captured_at) from category_snapshots) and c.market_cap is not null order by c.market_cap desc limit 60`;
    const gainers = [...rows].filter((r) => num(r.market_cap) !== null && num(r.market_cap)! > 1e9).sort((a, b) => (num(b.market_cap_change_24h) ?? 0) - (num(a.market_cap_change_24h) ?? 0));
    const fmt = (r: (typeof rows)[number]) => ({ id: r.category_id, name: r.name, market_cap_usd: compact(num(r.market_cap)), change_24h_pct: round(num(r.market_cap_change_24h)), volume_24h_usd: compact(num(r.volume_24h)), top_coins: r.top_3_coins_id });
    return section({ largest: rows.slice(0, 25).map(fmt), gaining_24h: gainers.slice(0, 10).map(fmt), losing_24h: gainers.slice(-10).reverse().map(fmt) }, rows[0]?.captured_at ?? null, [{ provider: "coingecko", endpoint: "/coins/categories", as_of: rows[0]?.captured_at }]);
  });

  run("breadth", async () => {
    const [b] = await sql`
      with latest as (select distinct on (coingecko_id) coingecko_id, current_price, price_change_percentage_24h, captured_at from market_snapshots where captured_at > now() - interval '10 minutes' and coingecko_id in (select coingecko_id from tokens where in_universe and not is_stablecoin) order by coingecko_id, captured_at desc),
      h1 as (select l.coingecko_id, l.current_price / nullif((select current_price from market_snapshots p where p.coingecko_id = l.coingecko_id and p.captured_at <= l.captured_at - interval '60 minutes' order by p.captured_at desc limit 1), 0) - 1 as r1h from latest l),
      oi as (select coingecko_id, bool_or(true) as has from open_interest_usd where venue = 'binanceusdm' and exchange_ts > now() - interval '20 minutes' group by 1),
      oi1 as (select o.coingecko_id, (select open_interest_usd from open_interest_usd x where x.coingecko_id = o.coingecko_id and x.venue = 'binanceusdm' order by exchange_ts desc limit 1) as now_oi,
                     (select open_interest_usd from open_interest_usd x where x.coingecko_id = o.coingecko_id and x.venue = 'binanceusdm' and x.exchange_ts <= now() - interval '60 minutes' order by exchange_ts desc limit 1) as oi_1h from oi o)
      select count(*)::int as coins,
             count(*) filter (where h1.r1h > 0)::int as up_1h, count(*) filter (where h1.r1h < 0)::int as down_1h,
             count(*) filter (where l.price_change_percentage_24h > 0)::int as up_24h, count(*) filter (where l.price_change_percentage_24h < 0)::int as down_24h,
             (select count(*) from oi1 where now_oi > oi_1h)::int as oi_rising, (select count(*) from oi1 where now_oi is not null and oi_1h is not null)::int as oi_tracked,
             max(l.captured_at) as at
      from latest l join h1 using (coingecko_id)`;
    return section({ coins: b.coins, up_1h: b.up_1h, down_1h: b.down_1h, up_1h_pct: round((b.up_1h / Math.max(b.coins, 1)) * 100, 1), up_24h: b.up_24h, down_24h: b.down_24h, up_24h_pct: round((b.up_24h / Math.max(b.coins, 1)) * 100, 1), rising_open_interest: b.oi_rising, rising_open_interest_pct: round((b.oi_rising / Math.max(b.oi_tracked, 1)) * 100, 1) }, b.at, [{ provider: "coingecko", endpoint: "/coins/markets", as_of: b.at }, { provider: "binanceusdm", endpoint: "openInterestHist" }]);
  });

  run("sentiment", async () => {
    const fng = await sql`select day, value, classification from market_sentiment_snapshots order by day desc limit 30`;
    const trending = await sql`select position, coingecko_id, name, symbol, market_cap_rank, price_change_percentage_24h_usd, captured_at from trending_snapshots where item_type = 'coin' and captured_at = (select max(captured_at) from trending_snapshots) order by position limit 15`;
    return section({ fear_greed: fng[0] ? { value: fng[0].value, label: fng[0].classification, day: fng[0].day, history_30d: fng.map((f) => [f.day, f.value]) } : "unassessed", trending: trending.map((t) => ({ position: t.position, id: t.coingecko_id, symbol: t.symbol, name: t.name, rank: t.market_cap_rank, change_24h_pct: round(num(t.price_change_percentage_24h_usd)) })) }, trending[0]?.captured_at ?? null, [{ provider: "alternative.me", endpoint: "/fng" }, { provider: "coingecko", endpoint: "/search/trending", as_of: trending[0]?.captured_at }]);
  });

  run("flows", async () => {
    const [st] = await sql`select sum(f.exchange_net_usd) filter (where f.window_start > now() - interval '1 hour') as net_1h, sum(f.exchange_net_usd) filter (where f.window_start > now() - interval '24 hours') as net_24h, sum(f.exchange_inflow_usd) filter (where f.window_start > now() - interval '24 hours') as in_24h, sum(f.exchange_outflow_usd) filter (where f.window_start > now() - interval '24 hours') as out_24h, max(window_start) as at
      from onchain_flow_snapshots f join tokens t using (coingecko_id) where t.is_stablecoin`;
    const [all] = await sql`select sum(f.exchange_net_usd) filter (where f.window_start > now() - interval '1 hour') as net_1h, sum(f.exchange_net_usd) filter (where f.window_start > now() - interval '24 hours') as net_24h from onchain_flow_snapshots f join tokens t using (coingecko_id) where not t.is_stablecoin`;
    const top = await sql`select f.coingecko_id, upper(t.symbol) as symbol, sum(f.exchange_net_usd) as net_24h from onchain_flow_snapshots f join tokens t using (coingecko_id) where not t.is_stablecoin and f.window_start > now() - interval '24 hours' group by 1, 2 order by 3 desc`;
    return section({
      stablecoins_to_exchanges: { net_1h_usd: compact(num(st?.net_1h)), net_24h_usd: compact(num(st?.net_24h)), inflow_24h_usd: compact(num(st?.in_24h)), outflow_24h_usd: compact(num(st?.out_24h)), note: "positive = stablecoins arriving on exchanges (buying power)" },
      all_tokens_net_to_exchanges: { net_1h_usd: compact(num(all?.net_1h)), net_24h_usd: compact(num(all?.net_24h)), note: "positive = coins arriving on exchanges (sell-side supply)" },
      largest_inflows_24h: top.slice(0, 10).map((r) => ({ id: r.coingecko_id, symbol: r.symbol, net_usd: compact(num(r.net_24h)) })),
      largest_outflows_24h: top.slice(-10).reverse().map((r) => ({ id: r.coingecko_id, symbol: r.symbol, net_usd: compact(num(r.net_24h)) })),
    }, st?.at ?? null, [{ provider: "nownodes", endpoint: "eth_getLogs", as_of: st?.at }]);
  });

  run("chains", async () => {
    const fees = await sql`select distinct on (chain) chain, base_fee_gwei, priority_fee_p50_gwei, gas_used_ratio, captured_at from chain_fee_snapshots order by chain, captured_at desc`;
    const [mem] = await sql`select * from btc_mempool_snapshots order by captured_at desc limit 1`;
    const [blk] = await sql`select height, block_ts, tx_count, total_output_btc, fees_btc, large_transfer_count from btc_block_snapshots order by height desc limit 1`;
    const nodes = await sql`select distinct on (interface) chain, interface, status, height, captured_at from nownodes_node_status where interface not like '%testnet%' and interface <> 'eth-sepolia' order by interface, captured_at desc`;
    return section({
      evm_fees: fees.map((f) => ({ chain: f.chain, base_fee_gwei: round(num(f.base_fee_gwei), 3), priority_fee_p50_gwei: round(num(f.priority_fee_p50_gwei), 3), block_fullness_pct: round(num(f.gas_used_ratio) !== null ? num(f.gas_used_ratio)! * 100 : null, 1), as_of: f.captured_at })),
      bitcoin: mem ? { mempool_tx_count: mem.tx_count, mempool_bytes: num(mem.bytes), fee_1_block_sat_vb: round(num(mem.fee_1_block_sat_vb), 1), fee_6_blocks_sat_vb: round(num(mem.fee_6_blocks_sat_vb), 1), as_of: mem.captured_at, latest_block: blk ? { height: Number(blk.height), at: blk.block_ts, transactions: blk.tx_count, output_btc: round(num(blk.total_output_btc)), fees_btc: round(num(blk.fees_btc), 4), large_transfers: blk.large_transfer_count } : null } : "unassessed",
      node_status: nodes.map((n) => ({ chain: n.chain, interface: n.interface, status: n.status, height: Number(n.height), as_of: n.captured_at })),
    }, fees[0]?.captured_at ?? mem?.captured_at ?? null, [{ provider: "nownodes", endpoint: "eth_feeHistory, getmempoolinfo, networks/status" }]);
  });

  run("venues", async () => {
    const rows = await sql`select distinct on (venue) venue, status, updated, eta, url, captured_at from exchange_status order by venue, captured_at desc`;
    return section({ exchanges: rows.map((r) => ({ venue: r.venue, status: r.status, updated: r.updated, eta: r.eta, as_of: r.captured_at })) }, rows[0]?.captured_at ?? null, [{ provider: "ccxt", endpoint: "fetchStatus", as_of: rows[0]?.captured_at }]);
  });

  run("rankings", async () => {
    const movers = await sql`
      with latest as (select distinct on (m.coingecko_id) m.coingecko_id, upper(t.symbol) as symbol, m.current_price, m.price_change_percentage_24h, m.total_volume, m.market_cap, m.captured_at from market_snapshots m join tokens t using (coingecko_id)
                      where m.captured_at > now() - interval '10 minutes' and t.in_universe and not t.is_stablecoin order by m.coingecko_id, m.captured_at desc)
      select l.*, (l.current_price / nullif((select current_price from market_snapshots p where p.coingecko_id = l.coingecko_id and p.captured_at <= l.captured_at - interval '60 minutes' order by p.captured_at desc limit 1), 0) - 1) * 100 as change_1h from latest l`;
    const by = (key: (r: (typeof movers)[number]) => number | null, desc = true, n = 10) => [...movers].filter((r) => key(r) !== null).sort((a, b) => (desc ? key(b)! - key(a)! : key(a)! - key(b)!)).slice(0, n).map((r) => ({ id: r.coingecko_id, symbol: r.symbol, price_usd: num(r.current_price), change_1h_pct: round(num(r.change_1h)), change_24h_pct: round(num(r.price_change_percentage_24h)), volume_24h_usd: compact(num(r.total_volume)) }));
    const sig = await sql`select s.kind, s.coingecko_id, upper(t.symbol) as symbol, s.direction, s.severity, s.value, s.ratio, s.event_ts from signals s join tokens t using (coingecko_id) where s.detected_at > now() - interval '24 hours' and s.coingecko_id is not null order by s.severity desc, s.detected_at desc`;
    const byKind = (kinds: string[], n = 10) => sig.filter((s) => kinds.includes(s.kind)).slice(0, n).map((s) => ({ id: s.coingecko_id, symbol: s.symbol, kind: s.kind, direction: s.direction, severity: s.severity, value: num(s.value), ratio: num(s.ratio), at: s.event_ts }));
    const whales = await sql`select o.coingecko_id, upper(t.symbol) as symbol, count(*)::int as transfers, sum(o.amount_usd) as usd, max(o.amount_usd) as largest from onchain_transfers o join tokens t using (coingecko_id) where o.block_ts > now() - interval '24 hours' and not t.is_stablecoin group by 1, 2 order by 4 desc limit 10`;
    const news = await sql`select c as id, upper(t.symbol) as symbol, count(*)::int as headlines from news_items n, unnest(n.coins) c join tokens t on t.coingecko_id = c where n.published_at > now() - interval '24 hours' group by 1, 2 order by 3 desc limit 10`;
    return section({
      gainers_1h: by((r) => num(r.change_1h)), losers_1h: by((r) => num(r.change_1h), false), gainers_24h: by((r) => num(r.price_change_percentage_24h)), losers_24h: by((r) => num(r.price_change_percentage_24h), false),
      volume_spikes: byKind(["volume_spike"]), open_interest_moves: byKind(["oi_change"]), funding_extremes: byKind(["funding_extreme"]), exchange_inflows: byKind(["exchange_inflow"]), exchange_outflows: byKind(["exchange_outflow"]), liquidation_clusters: byKind(["liquidation_cluster"]), risk_flags: byKind(["tvl_drop", "positioning_extreme"]),
      whale_activity_24h: whales.map((w) => ({ id: w.coingecko_id, symbol: w.symbol, large_transfers: w.transfers, usd: compact(num(w.usd)), largest_usd: compact(num(w.largest)) })),
      most_in_news_24h: news.map((n) => ({ id: n.id, symbol: n.symbol, headlines: n.headlines })),
    }, movers[0]?.captured_at ?? null, [{ provider: "coingecko", endpoint: "/coins/markets", as_of: movers[0]?.captured_at }, { provider: "coingraph", endpoint: "signals" }, { provider: "nownodes", endpoint: "onchain_transfers" }, { provider: "rss", endpoint: "news" }]);
  });

  run("events", async () => {
    const [transfers, liq, sig, headlines] = await Promise.all([
      sql`select o.coingecko_id, upper(t.symbol) as symbol, o.chain, o.tx_hash, o.block_ts, o.amount, o.amount_usd, o.from_entity, o.to_entity, o.direction from onchain_transfers o join tokens t using (coingecko_id) where o.block_ts > now() - interval '24 hours' and o.amount_usd >= 1000000 order by o.amount_usd desc limit 50`,
      sql`select coingecko_id, date_trunc('hour', event_ts) as hour, sum(notional_usd) as usd, count(*)::int as n from liquidations where event_ts > now() - interval '24 hours' group by 1, 2 having sum(notional_usd) >= 250000 order by 3 desc limit 30`,
      sql`select s.id, s.coingecko_id, upper(t.symbol) as symbol, s.kind, s.direction, s.severity, s.event_ts, s.investigation_id from signals s left join tokens t using (coingecko_id) where s.detected_at > now() - interval '24 hours' order by s.event_ts desc limit 100`,
      sql`select source, title, url, published_at, coins from news_items where published_at > now() - interval '24 hours' order by published_at desc limit 60`,
    ]);
    return section({
      whale_transfers: transfers.map((x) => ({ at: x.block_ts, id: x.coingecko_id, symbol: x.symbol, chain: x.chain, tx: x.tx_hash, amount: num(x.amount), usd: compact(num(x.amount_usd)), from_entity: x.from_entity, to_entity: x.to_entity, direction: x.direction })),
      liquidation_clusters: liq.map((x) => ({ hour: x.hour, id: x.coingecko_id, usd: compact(num(x.usd)), count: x.n })),
      signals: sig.map((s) => ({ at: s.event_ts, id: s.id, token: s.coingecko_id ?? "market", symbol: s.symbol, kind: s.kind, direction: s.direction, severity: s.severity, brief_id: s.investigation_id })),
      headlines: headlines.map((h) => ({ at: h.published_at, source: h.source, title: h.title, url: h.url, tokens: h.coins })),
    }, new Date(), [{ provider: "nownodes", endpoint: "onchain_transfers" }, { provider: "okx+binance", endpoint: "liquidations" }, { provider: "coingraph", endpoint: "signals" }, { provider: "rss", endpoint: "news" }]);
  });

  run("pulse", async () => {
    const [p] = await sql`select id, headline, brief, finished_at from investigations where coingecko_id = 'bitcoin' and status = 'done' order by finished_at desc limit 1`;
    return section({ status: "preview", note: "the hourly market-wide brief ships with the next release; the latest Bitcoin brief is shown meanwhile", latest_bitcoin_brief: p ? { id: p.id, headline: p.headline, summary: (p.brief as { summary?: string })?.summary, at: p.finished_at } : null }, p?.finished_at ?? null, [{ provider: "coingraph", endpoint: "explain" }]);
  });

  await Promise.all(tasks);
  const sources: Source[] = [];
  for (const s of Object.values(out) as { sources?: Source[] }[]) for (const src of s.sources ?? []) sources.push(src);
  return { sections: out, sources };
}
