import { sql } from "../db";
import { num, type Source, type Token } from "./respond";

// GET /v1/history/{token}: series (charts) and events over time.

export const SERIES = ["price", "market_cap", "volume", "candles", "open_interest", "funding", "long_short", "exchange_net_flow", "reserves", "tvl"] as const;
export type SeriesName = (typeof SERIES)[number];

export async function buildHistory(token: Token, since: Date | null, series: SeriesName[] = [...SERIES]) {
  const id = token.coingecko_id;
  const seriesFrom = since ?? new Date(Date.now() - 14 * 86_400_000);
  const eventsFrom = since ?? new Date(Date.now() - 86_400_000);
  const want = new Set(series);
  const sources: Source[] = [];
  const out: Record<string, unknown> = {};

  const tasks: Promise<void>[] = [];
  const add = (name: SeriesName, fn: () => Promise<unknown>, src: Source) => {
    if (!want.has(name)) return;
    tasks.push(fn().then((v) => { out[name] = v; sources.push(src); }));
  };

  // Price / market cap / volume: 5-minute points for the recent window, hourly beyond 14 days.
  add("price", async () => {
    const recent = await sql`
      select distinct on (b) b as t, current_price as price, market_cap, total_volume as volume
      from (select date_trunc('hour', captured_at) + floor(extract(minute from captured_at) / 5) * interval '5 minutes' as b, current_price, market_cap, total_volume, captured_at
            from market_snapshots where coingecko_id = ${id} and captured_at >= ${seriesFrom}) x order by b, captured_at desc`;
    const older = await sql`select ts as t, price, market_cap, total_volume as volume from market_chart_points where coingecko_id = ${id} and granularity = 'hourly' and ts >= ${new Date(seriesFrom.getTime() - 30 * 86_400_000)} and ts < ${seriesFrom} order by ts`;
    return { step: "5m (recent) / 1h (older)", points: [...older, ...recent].map((r) => [new Date(r.t).toISOString(), num(r.price), num(r.market_cap), num(r.volume)]), columns: ["t", "price_usd", "market_cap_usd", "volume_24h_usd"] };
  }, { provider: "coingecko", endpoint: "/coins/markets + /market_chart" });
  if (want.has("market_cap") || want.has("volume")) { out.market_cap = "included in price series"; out.volume = "included in price series"; }

  add("candles", async () => {
    const [p] = await sql`select venue, symbol from symbol_map where coingecko_id = ${id} and is_primary and market_type = 'spot' and price_check_ok limit 1`;
    if (!p) return "unassessed";
    const rows = await sql`select ts, open, high, low, close, volume, quote_volume_usd, trade_count, taker_buy_base_volume from cex_ohlcv_usd where venue = ${p.venue} and symbol = ${p.symbol} and timeframe = '1m' and ts >= ${new Date(Math.max(eventsFrom.getTime(), Date.now() - 86_400_000))} order by ts`;
    return { venue: p.venue, symbol: p.symbol, timeframe: "1m", columns: ["t", "open", "high", "low", "close", "volume", "quote_volume_usd", "trades", "taker_buy_volume"], points: rows.map((r) => [new Date(r.ts).toISOString(), num(r.open), num(r.high), num(r.low), num(r.close), num(r.volume), num(r.quote_volume_usd), r.trade_count, num(r.taker_buy_base_volume)]) };
  }, { provider: "ccxt", endpoint: "klines:1m" });

  add("open_interest", async () => {
    const rows = await sql`select venue, exchange_ts as t, open_interest_usd from open_interest_usd where coingecko_id = ${id} and exchange_ts >= ${seriesFrom} order by exchange_ts`;
    return groupByVenue(rows, (r) => [new Date(r.t).toISOString(), num(r.open_interest_usd)], ["t", "open_interest_usd"]);
  }, { provider: "ccxt", endpoint: "openInterestHistory" });

  add("funding", async () => {
    const rows = await sql`select venue, captured_at as t, funding_rate from funding_rate_snapshots where coingecko_id = ${id} and captured_at >= ${seriesFrom} order by captured_at`;
    return groupByVenue(rows, (r) => [new Date(r.t).toISOString(), num(r.funding_rate) !== null ? num(r.funding_rate)! * 100 : null], ["t", "funding_rate_pct"]);
  }, { provider: "ccxt", endpoint: "fetchFundingRates" });

  add("long_short", async () => {
    const rows = await sql`select venue, ts as t, global_long_short_ratio, top_account_long_short_ratio, top_position_long_short_ratio, taker_buy_sell_ratio from futures_sentiment_snapshots where coingecko_id = ${id} and ts >= ${seriesFrom} order by ts`;
    return groupByVenue(rows, (r) => [new Date(r.t).toISOString(), num(r.global_long_short_ratio), num(r.top_account_long_short_ratio), num(r.top_position_long_short_ratio), num(r.taker_buy_sell_ratio)], ["t", "all_accounts", "top_accounts", "top_positions", "taker_buy_sell"]);
  }, { provider: "binanceusdm+okx+bybit", endpoint: "longShortRatio" });

  add("exchange_net_flow", async () => {
    const rows = await sql`select window_start as t, exchange_inflow_usd, exchange_outflow_usd, exchange_net_usd, transfer_count, volume_usd from onchain_flow_snapshots where coingecko_id = ${id} and window_start >= ${seriesFrom} order by window_start`;
    return { step: "15m", columns: ["t", "inflow_usd", "outflow_usd", "net_usd", "transfers", "volume_usd"], points: rows.map((r) => [new Date(r.t).toISOString(), num(r.exchange_inflow_usd), num(r.exchange_outflow_usd), num(r.exchange_net_usd), r.transfer_count, num(r.volume_usd)]) };
  }, { provider: "nownodes", endpoint: "eth_getLogs" });

  add("reserves", async () => {
    const rows = await sql`select captured_at as t, entity, sum(balance) as balance, sum(balance_usd) as usd from exchange_reserve_snapshots where coingecko_id = ${id} and captured_at >= ${seriesFrom} group by 1, 2 order by 1`;
    const by: Record<string, unknown[]> = {};
    for (const r of rows) (by[r.entity] ??= []).push([new Date(r.t).toISOString(), num(r.balance), num(r.usd)]);
    return { step: "1h", columns: ["t", "balance", "usd"], by_exchange: by };
  }, { provider: "nownodes", endpoint: "blockbook:/address" });

  add("tvl", async () => {
    const rows = await sql`select captured_at as t, protocol, tvl_usd from protocol_tvl_snapshots where coingecko_id = ${id} and captured_at >= ${seriesFrom} order by captured_at`;
    const by: Record<string, unknown[]> = {};
    for (const r of rows) (by[r.protocol] ??= []).push([new Date(r.t).toISOString(), num(r.tvl_usd)]);
    return Object.keys(by).length ? { step: "6h", columns: ["t", "tvl_usd"], by_protocol: by } : "unassessed";
  }, { provider: "defillama", endpoint: "/protocols" });

  // Events.
  const events: Record<string, unknown> = {};
  tasks.push((async () => {
    const [transfers, liquidations, sigs, headlines, briefs] = await Promise.all([
      sql`select chain, tx_hash, block_ts, from_address, to_address, amount, amount_usd, from_entity, to_entity, direction from onchain_transfers where coingecko_id = ${id} and block_ts >= ${eventsFrom} order by block_ts desc limit 200`,
      sql`select venue, event_ts, side, position_side, price, quantity, notional_usd from liquidations where coingecko_id = ${id} and event_ts >= ${eventsFrom} order by event_ts desc limit 200`,
      sql`select id, kind, direction, severity, value, ratio, event_ts, details, investigation_id from signals where coingecko_id = ${id} and event_ts >= ${eventsFrom} order by event_ts desc`,
      sql`select source, title, url, published_at from news_items where ${id} = any(coins) and published_at >= ${eventsFrom} order by published_at desc`,
      sql`select id, headline, brief->>'direction' as direction, brief->>'severity' as severity, finished_at from investigations where coingecko_id = ${id} and status = 'done' and finished_at >= ${eventsFrom} order by finished_at desc`,
    ]);
    events.transfers = transfers.map((t) => ({ at: t.block_ts, chain: t.chain, tx: t.tx_hash, from: t.from_address, to: t.to_address, amount: num(t.amount), usd: num(t.amount_usd), from_entity: t.from_entity, to_entity: t.to_entity, direction: t.direction }));
    events.liquidations = liquidations.map((l) => ({ at: l.event_ts, venue: l.venue, side: l.position_side ?? (l.side === "SELL" ? "long" : "short"), price: num(l.price), quantity: num(l.quantity), usd: num(l.notional_usd) }));
    events.signals = sigs.map((s) => ({ at: s.event_ts, id: s.id, kind: s.kind, direction: s.direction, severity: s.severity, value: num(s.value), ratio: num(s.ratio), brief_id: s.investigation_id, details: s.details }));
    events.headlines = headlines.map((h) => ({ at: h.published_at, source: h.source, title: h.title, url: h.url }));
    events.briefs = briefs.map((b) => ({ at: b.finished_at, id: b.id, headline: b.headline, direction: b.direction, severity: num(b.severity), url: `/v1/explain/${id}/${b.id}` }));
    sources.push({ provider: "nownodes", endpoint: "onchain_transfers" }, { provider: "okx+binance", endpoint: "liquidations" }, { provider: "coingraph", endpoint: "signals" }, { provider: "rss", endpoint: "news" });
  })());

  await Promise.all(tasks);
  return { token: { id, symbol: token.symbol.toUpperCase(), name: token.name }, window: { series_from: seriesFrom.toISOString(), events_from: eventsFrom.toISOString(), to: new Date().toISOString() }, series: out, events, sources };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupByVenue(rows: { [column: string]: any }[], map: (r: { [column: string]: any }) => unknown[], columns: string[]) {
  const by: Record<string, unknown[]> = {};
  for (const r of rows) (by[String(r.venue)] ??= []).push(map(r));
  return Object.keys(by).length ? { columns, by_venue: by } : "unassessed";
}
