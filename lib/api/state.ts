import { sql } from "../db";
import { num, pctChange, round, section, type Section, type Source, type Token } from "./respond";

// GET /v1/state/{token}: everything known about a token right now, section by section. Each section carries
// its own as_of and sources; missing data is reported as "unassessed" rather than omitted or guessed.

export const STATE_SECTIONS = ["identity", "market", "liquidity", "derivatives", "onchain", "supply", "security", "context", "signals", "brief"] as const;
export type StateSection = (typeof STATE_SECTIONS)[number];

const UNASSESSED = "unassessed" as const;
const compact = (v: number | null) => (v === null ? null : Number(v.toPrecision(6)));

export async function buildState(token: Token, sections: StateSection[] = [...STATE_SECTIONS]) {
  const id = token.coingecko_id;
  const want = new Set(sections);
  const out: Record<string, unknown> = {};
  const tasks: Promise<void>[] = [];
  const run = (name: StateSection, fn: () => Promise<unknown>) => {
    if (want.has(name)) tasks.push(fn().then((v) => { out[name] = v; }).catch((err) => { out[name] = { error: (err as Error).message.slice(0, 200), as_of: null, sources: [] }; }));
  };

  run("identity", () => identity(id));
  run("market", () => market(id));
  run("liquidity", () => liquidity(id));
  run("derivatives", () => derivatives(id));
  run("onchain", () => onchain(id));
  run("supply", () => supply(id));
  run("security", () => security(id));
  run("context", () => context(id));
  run("signals", () => signals(id));
  run("brief", () => brief(id));
  await Promise.all(tasks);

  const sources: Source[] = [];
  let asOf: Date | null = null;
  for (const s of Object.values(out) as Section<object>[]) {
    for (const src of s.sources ?? []) sources.push(src);
    if (s.as_of && (!asOf || new Date(s.as_of) > asOf)) asOf = new Date(s.as_of);
  }
  return { token: { id, symbol: token.symbol.toUpperCase(), name: token.name, rank: token.market_cap_rank }, sections: out, as_of: asOf, sources };
}

async function identity(id: string) {
  const [t] = await sql`select coingecko_id, symbol, name, image, market_cap_rank, platforms, detail_platforms, categories, description, links, genesis_date, country_origin, is_stablecoin, is_demo, first_seen_at, detail_last_updated from tokens where coingecko_id = ${id}`;
  const venues = await sql`select venue, market_type, symbol, is_primary, price_check_ok from symbol_map where coingecko_id = ${id} and price_check_ok order by market_type, is_primary desc, venue`;
  const contracts = await sql`select chain, address, decimals from onchain_contracts where coingecko_id = ${id}`;
  const links = (t.links ?? {}) as Record<string, unknown>;
  return section({
    id: t.coingecko_id, symbol: String(t.symbol).toUpperCase(), name: t.name, image: (t.image as Record<string, string> | null)?.large ?? null, rank: t.market_cap_rank,
    categories: t.categories ?? [], is_stablecoin: t.is_stablecoin, genesis_date: t.genesis_date, country_origin: t.country_origin,
    description: typeof t.description === "string" ? t.description.slice(0, 600) : null,
    links: { homepage: (links.homepage as string[] | undefined)?.filter(Boolean)?.[0] ?? null, twitter: links.twitter_screen_name ?? null, github: (links.repos_url as { github?: string[] } | undefined)?.github?.[0] ?? null, whitepaper: links.whitepaper ?? null },
    chains: Object.fromEntries(Object.entries((t.platforms ?? {}) as Record<string, string>).filter(([, v]) => v)),
    tracked_contracts: contracts,
    venues: venues.map((v) => ({ venue: v.venue, type: v.market_type, symbol: v.symbol, primary: v.is_primary })),
    primary_venue: venues.find((v) => v.is_primary && v.market_type === "spot")?.venue ?? null,
    tracked_since: t.first_seen_at,
  }, t.detail_last_updated, [{ provider: "coingecko", endpoint: "/coins/{id}", as_of: t.detail_last_updated }, { provider: "ccxt", endpoint: "loadMarkets" }]);
}

async function market(id: string) {
  const [m] = await sql`
    select m.*,
      (select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '15 minutes' order by p.captured_at desc limit 1) as p15,
      (select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '60 minutes' order by p.captured_at desc limit 1) as p1h,
      (select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '4 hours' order by p.captured_at desc limit 1) as p4h,
      (select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '7 days' order by p.captured_at desc limit 1) as p7d,
      (select stddev_samp(r) * sqrt(24) * 100 from (select ln(current_price / nullif(lag(current_price, 60) over (order by captured_at), 0)) as r from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at > m.captured_at - interval '24 hours') x) as vol_24h_pct
    from market_snapshots m where m.coingecko_id = ${id} order by m.captured_at desc limit 1`;
  if (!m) return section({ status: UNASSESSED }, null, []);
  const price = num(m.current_price);
  return section({
    price_usd: price, market_cap_usd: num(m.market_cap), fully_diluted_valuation_usd: num(m.fully_diluted_valuation), volume_24h_usd: num(m.total_volume),
    rank: m.market_cap_rank,
    change_pct: { "15m": pctChange(price, num(m.p15)), "1h": pctChange(price, num(m.p1h)), "4h": pctChange(price, num(m.p4h)), "24h": round(num(m.price_change_percentage_24h)), "7d": num(m.pct_change_7d) ?? pctChange(price, num(m.p7d)), "30d": num(m.pct_change_30d), "200d": num(m.pct_change_200d), "1y": num(m.pct_change_1y) },
    high_24h_usd: num(m.high_24h), low_24h_usd: num(m.low_24h),
    ath_usd: num(m.ath), ath_date: m.ath_date, from_ath_pct: round(num(m.ath_change_percentage)), atl_usd: num(m.atl), from_atl_pct: round(num(m.atl_change_percentage)),
    volatility_24h_pct: round(num(m.vol_24h_pct)),
    volume_to_market_cap: num(m.total_volume) !== null && num(m.market_cap) ? round(num(m.total_volume)! / num(m.market_cap)!, 4) : null,
  }, m.captured_at, [{ provider: "coingecko", endpoint: "/coins/markets", as_of: m.captured_at }]);
}

async function liquidity(id: string) {
  const [books, tickers, cgTickers, pools] = await Promise.all([
    sql`select distinct on (venue) venue, symbol, best_bid, best_ask, spread_pct, depth_bid_2pct_usd, depth_ask_2pct_usd, captured_at from order_book_snapshots where coingecko_id = ${id} and captured_at > now() - interval '30 minutes' order by venue, captured_at desc`,
    sql`select distinct on (venue, market_type) venue, market_type, symbol, last, bid, ask, quote_volume, captured_at from cex_ticker_snapshots where coingecko_id = ${id} and market_type = 'spot' and captured_at > now() - interval '15 minutes' order by venue, market_type, captured_at desc`,
    sql`select market_name, base, target, converted_volume_usd, bid_ask_spread_percentage, cost_to_move_up_usd, cost_to_move_down_usd, trust_score, is_anomaly, is_stale, captured_at
        from exchange_tickers where coingecko_id = ${id} and captured_at = (select max(captured_at) from exchange_tickers where coingecko_id = ${id}) order by converted_volume_usd desc nulls last limit 25`,
    sql`select distinct on (pool_address) network, dex_id, name, pool_address, reserve_in_usd, volume_usd_h24, buys_h1, sells_h1, buyers_h1, sellers_h1, token_price_usd, captured_at
        from dex_pool_snapshots where coingecko_id = ${id} and captured_at > now() - interval '2 hours' order by pool_address, captured_at desc`,
  ]);
  const lasts = tickers.map((t) => num(t.last)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = lasts.length ? lasts[Math.floor(lasts.length / 2)] : null;
  const dispersion = median && lasts.length > 1 ? round(((lasts[lasts.length - 1] - lasts[0]) / median) * 100, 3) : null;
  const trusted = cgTickers.filter((t) => t.trust_score === "green" && !t.is_anomaly && !t.is_stale);
  const asOf = [books[0]?.captured_at, tickers[0]?.captured_at, cgTickers[0]?.captured_at, pools[0]?.captured_at].filter(Boolean).map((d) => new Date(d as Date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const depthBid = books.reduce((s, b) => s + (num(b.depth_bid_2pct_usd) ?? 0), 0), depthAsk = books.reduce((s, b) => s + (num(b.depth_ask_2pct_usd) ?? 0), 0);
  return section({
    order_books: books.length ? books.map((b) => ({ venue: b.venue, symbol: b.symbol, best_bid: num(b.best_bid), best_ask: num(b.best_ask), spread_pct: num(b.spread_pct), depth_2pct_bid_usd: compact(num(b.depth_bid_2pct_usd)), depth_2pct_ask_usd: compact(num(b.depth_ask_2pct_usd)), as_of: b.captured_at })) : UNASSESSED,
    depth_2pct_total_usd: books.length ? { bid: compact(depthBid), ask: compact(depthAsk), bid_ask_ratio: depthAsk ? round(depthBid / depthAsk) : null } : UNASSESSED,
    venues_tracked: tickers.map((t) => ({ venue: t.venue, symbol: t.symbol, last: num(t.last), bid: num(t.bid), ask: num(t.ask), volume_24h_quote: compact(num(t.quote_volume)) })),
    price_dispersion_pct: dispersion,
    exchanges: cgTickers.length ? { count: cgTickers.length, trusted_count: trusted.length, volume_24h_usd: compact(cgTickers.reduce((s, t) => s + (num(t.converted_volume_usd) ?? 0), 0)),
      median_spread_pct: round(cgTickers.map((t) => num(t.bid_ask_spread_percentage)).filter((v): v is number => v !== null).sort((a, b) => a - b)[Math.floor(cgTickers.length / 2)] ?? null, 3),
      cost_to_move_2pct_usd: { up: compact(cgTickers.reduce((s, t) => s + (num(t.cost_to_move_up_usd) ?? 0), 0)), down: compact(cgTickers.reduce((s, t) => s + (num(t.cost_to_move_down_usd) ?? 0), 0)) },
      top: cgTickers.slice(0, 10).map((t) => ({ exchange: t.market_name, pair: `${t.base}/${t.target}`, volume_24h_usd: compact(num(t.converted_volume_usd)), spread_pct: num(t.bid_ask_spread_percentage), trust: t.trust_score, anomaly: t.is_anomaly, stale: t.is_stale })) } : UNASSESSED,
    dex_pools: pools.length ? pools.map((p) => ({ network: p.network, dex: p.dex_id, pool: p.name, address: p.pool_address, liquidity_usd: compact(num(p.reserve_in_usd)), volume_24h_usd: compact(num(p.volume_usd_h24)), buys_1h: p.buys_h1, sells_1h: p.sells_h1, buyers_1h: p.buyers_h1, sellers_1h: p.sellers_h1, price_usd: num(p.token_price_usd) })) : UNASSESSED,
  }, asOf, [
    ...(books.length ? [{ provider: "ccxt", endpoint: "fetchOrderBook", as_of: books[0].captured_at }] : []),
    ...(tickers.length ? [{ provider: "ccxt", endpoint: "fetchTickers", as_of: tickers[0].captured_at }] : []),
    ...(cgTickers.length ? [{ provider: "coingecko", endpoint: "/coins/{id}/tickers", as_of: cgTickers[0].captured_at }] : []),
    ...(pools.length ? [{ provider: "coingecko", endpoint: "/onchain/.../pools", as_of: pools[0].captured_at }] : []),
  ]);
}

async function derivatives(id: string) {
  const [oi, oiHist, funding, sent, liq, cg] = await Promise.all([
    sql`select distinct on (venue) venue, symbol, open_interest_usd, open_interest_amount, exchange_ts from open_interest_usd where coingecko_id = ${id} and exchange_ts > now() - interval '30 minutes' order by venue, exchange_ts desc`,
    sql`select venue, exchange_ts, open_interest_usd from open_interest_usd where coingecko_id = ${id} and venue = 'binanceusdm' and exchange_ts > now() - interval '25 hours' order by exchange_ts desc`,
    sql`select distinct on (venue) venue, symbol, funding_rate, next_funding_rate, next_funding_ts, mark_price, index_price, interval, captured_at from funding_rate_snapshots where coingecko_id = ${id} and captured_at > now() - interval '30 minutes' order by venue, captured_at desc`,
    sql`select distinct on (venue) venue, ts, global_long_short_ratio, top_account_long_short_ratio, top_position_long_short_ratio, taker_buy_sell_ratio from futures_sentiment_snapshots where coingecko_id = ${id} and ts > now() - interval '40 minutes' order by venue, ts desc`,
    sql`select count(*) filter (where event_ts > now() - interval '1 hour')::int as n_1h, coalesce(sum(notional_usd) filter (where event_ts > now() - interval '1 hour'), 0) as usd_1h,
               coalesce(sum(notional_usd) filter (where event_ts > now() - interval '1 hour' and (side = 'SELL' or position_side = 'long')), 0) as longs_1h,
               count(*)::int as n_24h, coalesce(sum(notional_usd), 0) as usd_24h, coalesce(sum(notional_usd) filter (where side = 'SELL' or position_side = 'long'), 0) as longs_24h, max(notional_usd) as largest_24h
        from liquidations where coingecko_id = ${id} and event_ts > now() - interval '24 hours'`,
    sql`select count(*)::int as venues, sum(open_interest) as oi, sum(volume_24h) as volume, avg(funding_rate) as avg_funding, max(captured_at) as at from derivatives_tickers where coingecko_id = ${id} and captured_at = (select max(captured_at) from derivatives_tickers where coingecko_id = ${id})`,
  ]);
  const [mcapRow] = await sql`select market_cap from market_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`;
  const at = (h: number) => num(oiHist.find((r) => new Date(r.exchange_ts).getTime() <= Date.now() - h * 3600_000)?.open_interest_usd);
  const total = oi.reduce((s, r) => s + (num(r.open_interest_usd) ?? 0), 0);
  const binNow = num(oi.find((r) => r.venue === "binanceusdm")?.open_interest_usd);
  const l = liq[0];
  const asOf = oi[0]?.exchange_ts ?? funding[0]?.captured_at ?? null;
  if (!oi.length && !funding.length && !cg[0]?.venues) return section({ status: UNASSESSED, note: "no futures market tracked for this token" }, null, []);
  return section({
    open_interest: oi.length ? { total_usd: compact(total), by_venue: oi.map((r) => ({ venue: r.venue, symbol: r.symbol, usd: compact(num(r.open_interest_usd)), as_of: r.exchange_ts })),
      change_pct: { "1h": pctChange(binNow, at(1)), "4h": pctChange(binNow, at(4)), "24h": pctChange(binNow, at(24)) }, change_basis: "binanceusdm" } : UNASSESSED,
    funding: funding.length ? funding.map((f) => ({ venue: f.venue, symbol: f.symbol, rate_pct: round(num(f.funding_rate) !== null ? num(f.funding_rate)! * 100 : null, 4), next_rate_pct: round(num(f.next_funding_rate) !== null ? num(f.next_funding_rate)! * 100 : null, 4), next_at: f.next_funding_ts, annualised_pct: round(num(f.funding_rate) !== null ? num(f.funding_rate)! * 100 * 3 * 365 : null, 1), mark: num(f.mark_price), index: num(f.index_price), basis_pct: round(pctChange(num(f.mark_price), num(f.index_price)), 4) })) : UNASSESSED,
    positioning: sent.length ? sent.map((s) => ({ venue: s.venue, as_of: s.ts, long_short_all_accounts: round(num(s.global_long_short_ratio), 3), long_short_top_accounts: round(num(s.top_account_long_short_ratio), 3), long_short_top_positions: round(num(s.top_position_long_short_ratio), 3), taker_buy_sell: round(num(s.taker_buy_sell_ratio), 3) })) : UNASSESSED,
    liquidations: { "1h": { count: l.n_1h, usd: compact(num(l.usd_1h)), longs_usd: compact(num(l.longs_1h)), shorts_usd: compact(num(l.usd_1h)! - num(l.longs_1h)!) }, "24h": { count: l.n_24h, usd: compact(num(l.usd_24h)), longs_usd: compact(num(l.longs_24h)), shorts_usd: compact(num(l.usd_24h)! - num(l.longs_24h)!), largest_usd: compact(num(l.largest_24h)) }, venues: ["okx", "binance"] },
    leverage_ratio: num(mcapRow?.market_cap) && total ? round(total / num(mcapRow.market_cap)!, 4) : null,
    all_derivative_venues: cg[0]?.venues ? { venues: cg[0].venues, open_interest_usd: compact(num(cg[0].oi)), volume_24h_usd: compact(num(cg[0].volume)), avg_funding_pct: round(num(cg[0].avg_funding), 4), as_of: cg[0].at } : UNASSESSED,
  }, asOf, [
    ...(oi.length ? [{ provider: "ccxt", endpoint: "openInterest", as_of: oi[0].exchange_ts }] : []),
    ...(funding.length ? [{ provider: "ccxt", endpoint: "fetchFundingRates", as_of: funding[0].captured_at }] : []),
    ...(sent.length ? [{ provider: "binanceusdm", endpoint: "futuresSentiment", as_of: sent[0].ts }] : []),
    { provider: "okx+binance", endpoint: "liquidations" },
    ...(cg[0]?.at ? [{ provider: "coingecko", endpoint: "/derivatives", as_of: cg[0].at }] : []),
  ]);
}

async function onchain(id: string) {
  const [flows, transfers, reserves, holders, contracts] = await Promise.all([
    sql`select
          sum(transfer_count) filter (where window_start > now() - interval '1 hour')::int as n_1h, sum(volume_usd) filter (where window_start > now() - interval '1 hour') as vol_1h,
          sum(exchange_inflow_usd) filter (where window_start > now() - interval '1 hour') as in_1h, sum(exchange_outflow_usd) filter (where window_start > now() - interval '1 hour') as out_1h,
          sum(transfer_count) filter (where window_start > now() - interval '24 hours')::int as n_24h, sum(volume_usd) filter (where window_start > now() - interval '24 hours') as vol_24h,
          sum(exchange_inflow_usd) filter (where window_start > now() - interval '24 hours') as in_24h, sum(exchange_outflow_usd) filter (where window_start > now() - interval '24 hours') as out_24h,
          sum(exchange_inflow_usd) as in_7d, sum(exchange_outflow_usd) as out_7d, sum(mint_usd) filter (where window_start > now() - interval '24 hours') as mint_24h, sum(burn_usd) filter (where window_start > now() - interval '24 hours') as burn_24h,
          sum(unique_senders) filter (where window_start > now() - interval '24 hours')::int as senders_24h, sum(unique_receivers) filter (where window_start > now() - interval '24 hours')::int as receivers_24h,
          percentile_cont(0.5) within group (order by abs(exchange_net_usd)) as median_abs_net_15m, max(window_start) as at, max(chain) as chain
        from onchain_flow_snapshots where coingecko_id = ${id} and window_start > now() - interval '7 days'`,
    sql`select chain, tx_hash, block_ts, from_address, to_address, amount, amount_usd, from_entity, to_entity, direction from onchain_transfers where coingecko_id = ${id} and block_ts > now() - interval '24 hours' order by amount_usd desc nulls last limit 20`,
    sql`with latest as (select max(captured_at) as t from exchange_reserve_snapshots where coingecko_id = ${id})
        select r.entity, sum(r.balance) as bal, sum(r.balance_usd) as usd,
          (select sum(balance) from exchange_reserve_snapshots p where p.coingecko_id = ${id} and p.entity = r.entity and p.captured_at = (select max(captured_at) from exchange_reserve_snapshots q where q.coingecko_id = ${id} and q.captured_at <= latest.t - interval '24 hours')) as bal_24h,
          (select sum(balance) from exchange_reserve_snapshots p where p.coingecko_id = ${id} and p.entity = r.entity and p.captured_at = (select max(captured_at) from exchange_reserve_snapshots q where q.coingecko_id = ${id} and q.captured_at <= latest.t - interval '7 days')) as bal_7d,
          latest.t as at
        from exchange_reserve_snapshots r, latest where r.coingecko_id = ${id} and r.captured_at = latest.t group by r.entity, latest.t order by usd desc nulls last`,
    sql`select chain, captured_at, supply, top10_pct, top20_pct from token_holder_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    sql`select chain, address from onchain_contracts where coingecko_id = ${id}`,
  ]);
  const f = flows[0];
  const chain = f?.chain ?? contracts[0]?.chain ?? null;
  const [fee] = chain === "eth" || chain === "bsc" ? await sql`select chain, base_fee_gwei, priority_fee_p50_gwei, gas_used_ratio, captured_at from chain_fee_snapshots where chain = ${chain} order by captured_at desc limit 1` : [];
  const tracked = Boolean(f?.at) || transfers.length > 0 || reserves.length > 0 || Boolean(holders[0]);
  if (!tracked) return section({ status: UNASSESSED, note: "no onchain coverage for this token (chain not reachable through NOWNodes)" }, null, []);
  const net = (i: unknown, o: unknown) => (num(i) ?? 0) - (num(o) ?? 0);
  const totalReserves = reserves.reduce((s, r) => s + (num(r.bal) ?? 0), 0);
  return section({
    chain,
    exchange_flows: f?.at ? {
      "1h": { inflow_usd: compact(num(f.in_1h)), outflow_usd: compact(num(f.out_1h)), net_usd: compact(net(f.in_1h, f.out_1h)) },
      "24h": { inflow_usd: compact(num(f.in_24h)), outflow_usd: compact(num(f.out_24h)), net_usd: compact(net(f.in_24h, f.out_24h)) },
      "7d": { inflow_usd: compact(num(f.in_7d)), outflow_usd: compact(num(f.out_7d)), net_usd: compact(net(f.in_7d, f.out_7d)) },
      typical_15m_abs_net_usd: compact(num(f.median_abs_net_15m)), note: "positive net = coins arriving on exchanges (sell-side supply)",
    } : UNASSESSED,
    activity: f?.at ? { transfers_1h: f.n_1h, volume_1h_usd: compact(num(f.vol_1h)), transfers_24h: f.n_24h, volume_24h_usd: compact(num(f.vol_24h)), senders_24h: f.senders_24h, receivers_24h: f.receivers_24h, mint_24h_usd: compact(num(f.mint_24h)), burn_24h_usd: compact(num(f.burn_24h)) } : UNASSESSED,
    large_transfers_24h: transfers.map((t) => ({ chain: t.chain, tx: t.tx_hash, at: t.block_ts, from: t.from_address, to: t.to_address, amount: compact(num(t.amount)), usd: compact(num(t.amount_usd)), from_entity: t.from_entity, to_entity: t.to_entity, direction: t.direction })),
    exchange_reserves: reserves.length ? { total: compact(totalReserves), total_usd: compact(reserves.reduce((s, r) => s + (num(r.usd) ?? 0), 0)), as_of: reserves[0].at,
      by_exchange: reserves.map((r) => ({ exchange: r.entity, balance: compact(num(r.bal)), usd: compact(num(r.usd)), change_24h_pct: pctChange(num(r.bal), num(r.bal_24h)), change_7d_pct: pctChange(num(r.bal), num(r.bal_7d)) })) } : UNASSESSED,
    holder_concentration: holders[0] ? { chain: holders[0].chain, top10_pct: round(num(holders[0].top10_pct), 1), top20_pct: round(num(holders[0].top20_pct), 1), as_of: holders[0].captured_at } : UNASSESSED,
    network_fees: fee ? { chain: fee.chain, base_fee_gwei: round(num(fee.base_fee_gwei), 3), priority_fee_p50_gwei: round(num(fee.priority_fee_p50_gwei), 3), block_fullness_pct: round(num(fee.gas_used_ratio) !== null ? num(fee.gas_used_ratio)! * 100 : null, 1), as_of: fee.captured_at } : UNASSESSED,
  }, f?.at ?? reserves[0]?.at ?? null, [
    ...(f?.at ? [{ provider: "nownodes", endpoint: `${chain}:eth_getLogs`, as_of: f.at }] : []),
    ...(reserves.length ? [{ provider: "nownodes", endpoint: "blockbook:/address", as_of: reserves[0].at }] : []),
    ...(holders[0] ? [{ provider: "nownodes", endpoint: "sol:getTokenLargestAccounts", as_of: holders[0].captured_at }] : []),
  ]);
}

async function supply(id: string) {
  const [m] = await sql`select circulating_supply, total_supply, max_supply, market_cap, fully_diluted_valuation, captured_at,
      (select circulating_supply from market_snapshots p where p.coingecko_id = ${id} and p.captured_at <= now() - interval '7 days' order by captured_at desc limit 1) as circ_7d,
      (select circulating_supply from market_snapshots p where p.coingecko_id = ${id} and p.captured_at <= now() - interval '30 days' order by captured_at desc limit 1) as circ_30d
    from market_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`;
  const [res] = await sql`select sum(balance) as bal from exchange_reserve_snapshots where coingecko_id = ${id} and captured_at = (select max(captured_at) from exchange_reserve_snapshots where coingecko_id = ${id})`;
  const [solHold] = await sql`select top10_pct, top20_pct, captured_at from token_holder_snapshots where coingecko_id = ${id} and top10_pct is not null order by captured_at desc limit 1`;
  const [gpHold] = solHold ? [] : await sql`select top10_holders_pct as top10_pct, null::numeric as top20_pct, captured_at from token_security_snapshots where coingecko_id = ${id} and top10_holders_pct is not null order by captured_at desc limit 1`;
  const hold = solHold ?? gpHold;
  const treasuries = await sql`select distinct on (entity_type) entity_type, total_holdings, total_value_usd, market_cap_dominance, holders_count, captured_at from public_treasury_snapshots where coingecko_id = ${id} order by entity_type, captured_at desc`;
  if (!m) return section({ status: UNASSESSED }, null, []);
  const circ = num(m.circulating_supply), total = num(m.total_supply), max = num(m.max_supply);
  return section({
    circulating: circ, total, max,
    issued_pct_of_max: circ !== null && max ? round((circ / max) * 100, 1) : null,
    fdv_to_market_cap: num(m.fully_diluted_valuation) && num(m.market_cap) ? round(num(m.fully_diluted_valuation)! / num(m.market_cap)!, 2) : null,
    circulating_change_pct: { "7d": pctChange(circ, num(m.circ_7d)), "30d": pctChange(circ, num(m.circ_30d)) },
    exchange_held_pct: num(res?.bal) !== null && circ ? round((num(res.bal)! / circ) * 100, 2) : UNASSESSED,
    top_holders_pct: hold ? { top10: round(num(hold.top10_pct), 1), top20: round(num(hold.top20_pct), 1), as_of: hold.captured_at } : UNASSESSED,
    public_treasuries: treasuries.length ? treasuries.map((t) => ({ holders: t.entity_type, units: num(t.total_holdings), usd: compact(num(t.total_value_usd)), pct_of_market_cap: round(num(t.market_cap_dominance), 2), count: t.holders_count, as_of: t.captured_at })) : UNASSESSED,
    unlocks: UNASSESSED,
  }, m.captured_at, [{ provider: "coingecko", endpoint: "/coins/markets", as_of: m.captured_at }, ...(treasuries.length ? [{ provider: "coingecko", endpoint: "/public_treasury", as_of: treasuries[0].captured_at }] : [])]);
}

async function context(id: string) {
  const [news, tvl, detail, trend, fng] = await Promise.all([
    sql`select source, title, url, published_at from news_items where ${id} = any(coins) and published_at > now() - interval '24 hours' order by published_at desc limit 15`,
    sql`select protocol, name, category, tvl_usd, change_1d_pct, change_7d_pct, captured_at from protocol_tvl_snapshots where coingecko_id = ${id} and captured_at = (select max(captured_at) from protocol_tvl_snapshots where coingecko_id = ${id}) order by tvl_usd desc`,
    sql`select captured_at, developer_data, community_data, sentiment_votes_up_percentage, watchlist_portfolio_users from coin_detail_snapshots where coingecko_id = ${id} order by captured_at desc limit 1`,
    sql`select position, score, captured_at from trending_snapshots where coingecko_id = ${id} and captured_at > now() - interval '2 hours' order by captured_at desc limit 1`,
    sql`select day, value, classification from market_sentiment_snapshots order by day desc limit 1`,
  ]);
  const d = detail[0];
  const dev = (d?.developer_data ?? {}) as Record<string, unknown>;
  const com = (d?.community_data ?? {}) as Record<string, unknown>;
  return section({
    news_24h: news.map((n) => ({ source: n.source, title: n.title, url: n.url, at: n.published_at })),
    protocol_tvl: tvl.length ? tvl.map((t) => ({ protocol: t.protocol, name: t.name, category: t.category, tvl_usd: compact(num(t.tvl_usd)), change_1d_pct: round(num(t.change_1d_pct)), change_7d_pct: round(num(t.change_7d_pct)), as_of: t.captured_at })) : UNASSESSED,
    development: d && dev.commit_count_4_weeks != null ? { commits_4w: dev.commit_count_4_weeks, prs_merged: dev.pull_requests_merged ?? null, stars: dev.stars ?? null, forks: dev.forks ?? null, as_of: d.captured_at } : UNASSESSED,
    community: d && (com.twitter_followers != null || com.reddit_subscribers != null) ? { x_followers: com.twitter_followers ?? null, reddit_subscribers: com.reddit_subscribers ?? null, watchlist_users: d.watchlist_portfolio_users ?? null, sentiment_positive_pct: round(num(d.sentiment_votes_up_percentage)), as_of: d.captured_at } : UNASSESSED,
    trending: trend[0] ? { position: trend[0].position, score: trend[0].score, as_of: trend[0].captured_at } : null,
    fear_greed: fng[0] ? { value: fng[0].value, label: fng[0].classification, day: fng[0].day } : UNASSESSED,
  }, news[0]?.published_at ?? d?.captured_at ?? null, [
    { provider: "rss", endpoint: "coindesk,cointelegraph,decrypt,theblock" },
    ...(tvl.length ? [{ provider: "defillama", endpoint: "/protocols", as_of: tvl[0].captured_at }] : []),
    ...(d ? [{ provider: "coingecko", endpoint: "/coins/{id}", as_of: d.captured_at }] : []),
    ...(fng[0] ? [{ provider: "alternative.me", endpoint: "/fng" }] : []),
  ]);
}

async function signals(id: string) {
  const rows = await sql`select id, kind, direction, severity, value, baseline, ratio, event_ts, details, investigation_id, status from signals where coingecko_id = ${id} and detected_at > now() - interval '24 hours' order by severity desc, event_ts desc limit 30`;
  return section({ open: rows.map((s) => ({ id: s.id, kind: s.kind, direction: s.direction, severity: s.severity, value: num(s.value), baseline: num(s.baseline), ratio: num(s.ratio), at: s.event_ts, status: s.status, brief_id: s.investigation_id, details: s.details })) }, rows[0]?.event_ts ?? null, [{ provider: "coingraph", endpoint: "signals" }]);
}

async function brief(id: string) {
  const [b] = await sql`select id, headline, brief->>'direction' as direction, brief->>'severity' as severity, brief->>'confidence' as confidence, brief->>'summary' as summary, finished_at from investigations where coingecko_id = ${id} and status = 'done' order by finished_at desc limit 1`;
  if (!b) return section({ status: "none", note: "no investigation has run for this token yet; POST /v1/explain to run one" }, null, []);
  return section({ id: b.id, headline: b.headline, direction: b.direction, severity: num(b.severity), confidence: num(b.confidence), summary: b.summary, at: b.finished_at, url: `/v1/explain/${id}/${b.id}` }, b.finished_at, [{ provider: "coingraph", endpoint: "explain", as_of: b.finished_at }]);
}

// Contract security (GoPlus): honeypot, taxes, mint/freeze/blacklist/pause powers, upgradeability, per chain.
async function security(id: string) {
  const rows = await sql`
    select distinct on (chain) chain, address, captured_at, risk_level, risk_flags, is_honeypot, buy_tax_pct, sell_tax_pct, is_mintable, is_proxy, has_blacklist,
           transfer_pausable, hidden_owner, owner_change_balance, is_open_source, freezable, trusted_token, holder_count, top10_holders_pct, owner_address
    from token_security_snapshots where coingecko_id = ${id} order by chain, captured_at desc`;
  if (!rows.length) return section({ status: UNASSESSED, note: "no token contract on Ethereum, BNB Chain or Solana (native coin) — contract checks do not apply" }, null, []);
  // The token is rated on its home-chain contract (where it was issued); bridged copies are listed but don't set the rating.
  const [t] = await sql`select asset_platform_id from tokens where coingecko_id = ${id}`;
  const homeChain = ({ ethereum: "eth", "binance-smart-chain": "bsc", solana: "sol" } as Record<string, string>)[t?.asset_platform_id ?? ""] ?? null;
  const order = { high: 2, medium: 1, low: 0 } as Record<string, number>;
  const home = rows.find((r) => r.chain === homeChain);
  const worst = rows.reduce((w, r) => (order[r.risk_level] > order[w] ? r.risk_level : w), "low" as string);
  return section({
    risk_level: home ? home.risk_level : worst,
    rated_on: home ? `${home.chain} (home chain)` : "worst of all copies (no home-chain contract scanned)",
    contracts: rows.map((r) => ({
      chain: r.chain, home_chain: r.chain === homeChain, address: r.address, risk_level: r.risk_level, flags: r.risk_flags,
      honeypot: r.is_honeypot, buy_tax_pct: num(r.buy_tax_pct), sell_tax_pct: num(r.sell_tax_pct), mintable: r.is_mintable, upgradeable: r.is_proxy,
      blacklist: r.has_blacklist, pausable: r.transfer_pausable, hidden_owner: r.hidden_owner, owner_can_change_balances: r.owner_change_balance,
      verified_source: r.is_open_source, freezable: r.freezable, on_trust_lists: r.trusted_token, holders: r.holder_count !== null ? Number(r.holder_count) : null,
      top10_holders_pct: num(r.top10_holders_pct), owner: r.owner_address, as_of: r.captured_at,
    })),
  }, rows[0].captured_at, [{ provider: "goplus", endpoint: "/token_security", as_of: rows[0].captured_at }]);
}
