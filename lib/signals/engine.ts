import { sql } from "../db";
import { env } from "../env";

// Signal engine: every minute, each rule runs as one SQL query over data already in the database
// (no API calls) and returns the coins where something unusual is happening right now. A signal is
// recorded once per coin, rule and 15-minute bucket (re-recorded only if it got stronger), and when a
// coin's recent signals add up past a threshold an investigation is queued.

export type SignalRow = {
  coingecko_id: string | null;
  kind: string;
  direction: "up" | "down" | "neutral";
  severity: number;
  value: number | null;
  baseline: number | null;
  ratio: number | null;
  window_sec: number;
  event_ts: Date;
  details: Record<string, unknown> | null;
};

type Rule = { kind: string; run: () => Promise<SignalRow[]> };

// Non-stablecoin coins in the universe (stablecoins get their own market-wide rule).
const COINS = sql`select coingecko_id from tokens where in_universe and not is_stablecoin`;

// 1. Price move: 15-min and 1-hour returns vs this coin's own 24h volatility of 1-hour returns.
async function priceMove(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with latest as (
      select distinct on (coingecko_id) coingecko_id, current_price as p, captured_at
      from market_snapshots where captured_at > now() - interval '5 minutes' and coingecko_id in (${COINS})
      order by coingecko_id, captured_at desc),
    ref as (
      select l.coingecko_id, l.p, l.captured_at,
        (select current_price from market_snapshots m where m.coingecko_id = l.coingecko_id and m.captured_at <= l.captured_at - interval '15 minutes' and m.captured_at > l.captured_at - interval '25 minutes' order by m.captured_at desc limit 1) as p15,
        (select current_price from market_snapshots m where m.coingecko_id = l.coingecko_id and m.captured_at <= l.captured_at - interval '60 minutes' and m.captured_at > l.captured_at - interval '70 minutes' order by m.captured_at desc limit 1) as p60
      from latest l),
    vol as (
      select coingecko_id, stddev_samp(r) as sd from (
        select coingecko_id, ln(current_price / nullif(lag(current_price, 60) over (partition by coingecko_id order by captured_at), 0)) as r
        from market_snapshots where captured_at > now() - interval '24 hours' and coingecko_id in (${COINS})) x
      where r is not null group by 1),
    calc as (
      select r.coingecko_id, r.captured_at, r.p,
        (r.p / nullif(r.p15, 0) - 1) * 100 as ret15,
        (r.p / nullif(r.p60, 0) - 1) * 100 as ret60,
        abs(ln(r.p / nullif(r.p60, 0))) / nullif(v.sd, 0) as z
      from ref r left join vol v using (coingecko_id) where r.p15 is not null and r.p60 is not null)
    select coingecko_id, 'price_move' as kind,
      case when coalesce(ret15, 0) + coalesce(ret60, 0) < 0 then 'down' else 'up' end as direction,
      case when z >= 4 or abs(ret15) >= 5 or abs(ret60) >= 8 then 3 else 2 end as severity,
      round(ret60::numeric, 3) as value, round((100 * (exp(coalesce(sd_z.sd, 0)) - 1))::numeric, 3) as baseline, round(z::numeric, 2) as ratio,
      3600 as window_sec, captured_at as event_ts,
      jsonb_build_object('ret_15m_pct', round(ret15::numeric, 3), 'ret_1h_pct', round(ret60::numeric, 3), 'z_1h', round(z::numeric, 2), 'price', p) as details
    from calc left join vol sd_z using (coingecko_id)
    where (z >= 2.5 and (abs(ret60) >= 1.5 or abs(ret15) >= 1)) or abs(ret15) >= 3 or abs(ret60) >= 5`;
}

// 2. Volume spike: last 15 min of spot volume (primary venue) vs the median 15-min volume of the last 24h.
async function volumeSpike(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with primary_spot as (select venue, symbol, coingecko_id from symbol_map where is_primary and market_type = 'spot' and price_check_ok and coingecko_id in (${COINS})),
    buckets as (
      select c.coingecko_id, date_trunc('hour', c.ts) + floor(extract(minute from c.ts) / 15) * interval '15 minutes' as b, sum(c.quote_volume_usd) as v
      from cex_ohlcv_usd c join primary_spot p using (venue, symbol)
      where c.timeframe = '1m' and c.ts > now() - interval '24 hours' and c.ts < date_trunc('minute', now())
      group by 1, 2),
    cur as (select coingecko_id, sum(v) as v from (select coingecko_id, v, b from buckets) x where b >= date_trunc('minute', now()) - interval '15 minutes' group by 1),
    base as (select coingecko_id, percentile_cont(0.5) within group (order by v) as med from buckets where b < date_trunc('minute', now()) - interval '15 minutes' group by 1)
    select c.coingecko_id, 'volume_spike' as kind, 'neutral' as direction,
      case when c.v / nullif(b.med, 0) >= 6 then 3 else 2 end as severity,
      round(c.v) as value, round(b.med) as baseline, round((c.v / nullif(b.med, 0))::numeric, 2) as ratio,
      900 as window_sec, now() as event_ts,
      jsonb_build_object('volume_usd_15m', round(c.v), 'median_15m_24h', round(b.med)) as details
    from cur c join base b using (coingecko_id)
    where c.v >= 500000 and c.v / nullif(b.med, 0) >= 3`;
}

// 3. Open interest change over the last hour (Binance futures).
async function oiChange(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with cur as (select distinct on (coingecko_id) coingecko_id, open_interest_usd as oi, exchange_ts from open_interest_usd
                 where venue = 'binanceusdm' and exchange_ts > now() - interval '20 minutes' and coingecko_id in (${COINS}) order by coingecko_id, exchange_ts desc),
    prev as (select c.coingecko_id, (select open_interest_usd from open_interest_usd o where o.venue = 'binanceusdm' and o.coingecko_id = c.coingecko_id
                 and o.exchange_ts <= c.exchange_ts - interval '60 minutes' and o.exchange_ts > c.exchange_ts - interval '80 minutes' order by o.exchange_ts desc limit 1) as oi
             from cur c)
    select c.coingecko_id, 'oi_change' as kind, case when c.oi > p.oi then 'up' else 'down' end as direction,
      case when abs(c.oi / nullif(p.oi, 0) - 1) >= 0.10 then 3 else 2 end as severity,
      round(c.oi) as value, round(p.oi) as baseline, round(((c.oi / nullif(p.oi, 0) - 1) * 100)::numeric, 2) as ratio,
      3600 as window_sec, c.exchange_ts as event_ts,
      jsonb_build_object('oi_usd', round(c.oi), 'oi_usd_1h_ago', round(p.oi), 'change_pct', round(((c.oi / nullif(p.oi, 0) - 1) * 100)::numeric, 2)) as details
    from cur c join prev p using (coingecko_id)
    where p.oi > 1000000 and abs(c.oi / nullif(p.oi, 0) - 1) >= 0.05`;
}

// 4. Funding rate extremes (crowded longs or shorts), Binance futures.
async function fundingExtreme(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    select distinct on (coingecko_id) coingecko_id, 'funding_extreme' as kind,
      case when funding_rate > 0 then 'up' else 'down' end as direction,
      case when abs(funding_rate) >= 0.001 then 3 else 2 end as severity,
      round((funding_rate * 100)::numeric, 4) as value, 0.01 as baseline, round((abs(funding_rate) / 0.0001)::numeric, 1) as ratio,
      28800 as window_sec, captured_at as event_ts,
      jsonb_build_object('funding_rate_pct', round((funding_rate * 100)::numeric, 4), 'symbol', symbol) as details
    from funding_rate_snapshots
    where venue = 'binanceusdm' and captured_at > now() - interval '15 minutes' and abs(funding_rate) >= 0.0005 and coingecko_id in (${COINS})
    order by coingecko_id, captured_at desc`;
}

// 5. Liquidation cluster: last 15 min of liquidations vs the average 15-min amount over 24h.
async function liquidationCluster(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with cur as (select coingecko_id, sum(notional_usd) as v, sum(notional_usd) filter (where side = 'SELL' or position_side = 'long') as longs
                 from liquidations where event_ts > now() - interval '15 minutes' and coingecko_id in (${COINS}) group by 1),
    base as (select coingecko_id, sum(notional_usd) / 96.0 as avg15 from liquidations where event_ts > now() - interval '24 hours' group by 1)
    select c.coingecko_id, 'liquidation_cluster' as kind,
      case when c.longs >= c.v / 2 then 'down' else 'up' end as direction,
      case when c.v >= 1000000 and c.v / nullif(b.avg15, 0) >= 10 then 3 else 2 end as severity,
      round(c.v) as value, round(b.avg15) as baseline, round((c.v / nullif(b.avg15, 0))::numeric, 1) as ratio,
      900 as window_sec, now() as event_ts,
      jsonb_build_object('liquidated_usd_15m', round(c.v), 'longs_usd', round(coalesce(c.longs, 0)), 'avg_15m_24h', round(b.avg15)) as details
    from cur c join base b using (coingecko_id)
    where c.v >= 250000 and c.v / nullif(b.avg15, 0) >= 5`;
}

// 6. Exchange inflow / outflow (onchain): net flow to exchanges over the last 30 min vs this coin's 7-day median.
async function exchangeFlow(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with cur as (select coingecko_id, sum(exchange_net_usd) as net, sum(exchange_inflow_usd) as inflow, sum(exchange_outflow_usd) as outflow
                 from onchain_flow_snapshots where window_start >= now() - interval '30 minutes' and coingecko_id in (${COINS}) group by 1),
    base as (select coingecko_id, percentile_cont(0.5) within group (order by abs(exchange_net_usd)) as med
             from onchain_flow_snapshots where window_start > now() - interval '7 days' and window_start < now() - interval '30 minutes' group by 1)
    select c.coingecko_id, case when c.net > 0 then 'exchange_inflow' else 'exchange_outflow' end as kind,
      case when c.net > 0 then 'down' else 'up' end as direction,
      case when abs(c.net) >= 5000000 then 3 else 2 end as severity,
      round(c.net) as value, round(coalesce(b.med, 0)) as baseline, round((abs(c.net) / nullif(b.med, 0))::numeric, 1) as ratio,
      1800 as window_sec, now() as event_ts,
      jsonb_build_object('net_usd_30m', round(c.net), 'inflow_usd', round(c.inflow), 'outflow_usd', round(c.outflow), 'median_abs_net_15m_7d', round(coalesce(b.med, 0))) as details
    from cur c left join base b using (coingecko_id)
    where abs(c.net) >= 1000000 and (b.med is null or abs(c.net) / nullif(b.med, 0) >= 3)`;
}

// 7. Whale transfer: the largest onchain transfer of the coin in the last 30 min. Moves to or from an
// exchange count from $2M; untagged wallet-to-wallet moves (often DeFi contracts) only from $10M;
// exchanges shuffling their own wallets, mints and burns are not whale activity.
async function whaleTransfer(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    select distinct on (coingecko_id) coingecko_id, 'whale_transfer' as kind,
      case direction when 'to_exchange' then 'down' when 'from_exchange' then 'up' else 'neutral' end as direction,
      case when (direction in ('to_exchange', 'from_exchange') and amount_usd >= 10000000) or amount_usd >= 50000000 then 3 else 2 end as severity,
      round(amount_usd) as value, null::numeric as baseline, null::numeric as ratio,
      1800 as window_sec, block_ts as event_ts,
      jsonb_build_object('chain', chain, 'tx_hash', tx_hash, 'amount', round(amount, 4), 'amount_usd', round(amount_usd), 'from', from_address, 'to', to_address,
                         'from_entity', from_entity, 'to_entity', to_entity, 'direction', direction) as details
    from onchain_transfers
    where block_ts > now() - interval '30 minutes' and coingecko_id in (${COINS})
      and ((direction in ('to_exchange', 'from_exchange') and amount_usd >= 2000000) or (direction = 'other' and amount_usd >= 10000000))
    order by coingecko_id, amount_usd desc`;
}

// 8. Market-wide: stablecoins flowing onto exchanges (buying power) over the last hour vs the 7-day hourly median.
async function stablecoinInflow(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with hourly as (
      select date_trunc('hour', f.window_start) as h, sum(f.exchange_net_usd) as net
      from onchain_flow_snapshots f join tokens t using (coingecko_id) where t.is_stablecoin and f.window_start > now() - interval '7 days' group by 1),
    cur as (select sum(f.exchange_net_usd) as net from onchain_flow_snapshots f join tokens t using (coingecko_id) where t.is_stablecoin and f.window_start >= now() - interval '60 minutes'),
    base as (select percentile_cont(0.5) within group (order by abs(net)) as med from hourly where h < date_trunc('hour', now()))
    select null::text as coingecko_id, 'stablecoin_exchange_inflow' as kind, 'up' as direction,
      case when c.net >= 200000000 then 3 else 2 end as severity,
      round(c.net) as value, round(coalesce(b.med, 0)) as baseline, round((c.net / nullif(b.med, 0))::numeric, 1) as ratio,
      3600 as window_sec, now() as event_ts,
      jsonb_build_object('stablecoin_net_to_exchanges_usd_1h', round(c.net), 'median_abs_hourly_7d', round(coalesce(b.med, 0))) as details
    from cur c, base b
    where c.net >= 50000000 and (b.med is null or c.net / nullif(b.med, 0) >= 3)`;
}

// 9. Positioning extreme: Binance top-trader position ratio far from its own 7-day average.
async function positioningExtreme(): Promise<SignalRow[]> {
  return sql<SignalRow[]>`
    with cur as (select distinct on (coingecko_id) coingecko_id, top_position_long_short_ratio as r, ts from futures_sentiment_snapshots
                 where venue = 'binanceusdm' and ts > now() - interval '30 minutes' and top_position_long_short_ratio is not null and coingecko_id in (${COINS}) order by coingecko_id, ts desc),
    base as (select coingecko_id, avg(top_position_long_short_ratio) as avg_r from futures_sentiment_snapshots
             where venue = 'binanceusdm' and ts > now() - interval '7 days' and top_position_long_short_ratio is not null group by 1)
    select c.coingecko_id, 'positioning_extreme' as kind, case when c.r > b.avg_r then 'up' else 'down' end as direction, 2 as severity,
      round(c.r::numeric, 3) as value, round(b.avg_r::numeric, 3) as baseline, round((c.r / nullif(b.avg_r, 0))::numeric, 2) as ratio,
      1800 as window_sec, c.ts as event_ts,
      jsonb_build_object('top_position_long_short', round(c.r::numeric, 3), 'avg_7d', round(b.avg_r::numeric, 3)) as details
    from cur c join base b using (coingecko_id)
    where c.r / nullif(b.avg_r, 0) >= 1.5 or c.r / nullif(b.avg_r, 0) <= 0.67`;
}

const RULES: Rule[] = [
  { kind: "price_move", run: priceMove },
  { kind: "volume_spike", run: volumeSpike },
  { kind: "oi_change", run: oiChange },
  { kind: "funding_extreme", run: fundingExtreme },
  { kind: "liquidation_cluster", run: liquidationCluster },
  { kind: "exchange_flow", run: exchangeFlow },
  { kind: "whale_transfer", run: whaleTransfer },
  { kind: "stablecoin_inflow", run: stablecoinInflow },
  { kind: "positioning_extreme", run: positioningExtreme },
];

// Weights for the composite score that opens an investigation.
const WEIGHT: Record<string, number> = { price_move: 1.5, volume_spike: 1, oi_change: 1, funding_extreme: 0.5, liquidation_cluster: 1, exchange_inflow: 1.25, exchange_outflow: 1, whale_transfer: 1, positioning_extreme: 0.5 };
export const INVESTIGATION_SCORE = Number(process.env.SIGNAL_INVESTIGATION_SCORE ?? 5);
export const INVESTIGATION_SCORE_DEMO = Number(process.env.SIGNAL_INVESTIGATION_SCORE_DEMO ?? 3.5);
const INVESTIGATION_COOLDOWN_MIN = 120;

async function recordSignals(rows: SignalRow[]): Promise<number> {
  let n = 0;
  for (const s of rows) {
    const result = await sql`
      insert into signals (coingecko_id, kind, direction, severity, value, baseline, ratio, window_sec, event_ts, bucket, details)
      values (${s.coingecko_id}, ${s.kind}, ${s.direction}, ${s.severity}, ${s.value}, ${s.baseline}, ${s.ratio}, ${s.window_sec}, ${s.event_ts},
              to_timestamp(floor(extract(epoch from ${s.event_ts}::timestamptz) / 900) * 900), ${s.details ? sql.json(s.details as never) : null})
      on conflict (coalesce(coingecko_id, 'market'), kind, bucket) do update set
        severity = excluded.severity, direction = excluded.direction, value = excluded.value, baseline = excluded.baseline, ratio = excluded.ratio,
        event_ts = excluded.event_ts, details = excluded.details, detected_at = now()
      where excluded.severity > signals.severity or (excluded.severity = signals.severity and abs(coalesce(excluded.ratio, 0)) > abs(coalesce(signals.ratio, 0)))
      returning (xmax = 0) as inserted`;
    if (result[0]?.inserted) n++;
  }
  return n;
}

// Opens an investigation for coins whose signals of the last 30 minutes add up past the threshold.
async function queueInvestigations(): Promise<number> {
  const scores = await sql<{ coingecko_id: string; score: number; ids: number[]; is_demo: boolean }[]>`
    select s.coingecko_id, sum(s.severity * coalesce((${sql.json(WEIGHT as never)}::jsonb ->> s.kind)::numeric, 1))::numeric as score, array_agg(s.id) as ids, bool_or(t.is_demo) as is_demo
    from signals s join tokens t using (coingecko_id)
    where s.coingecko_id is not null and s.detected_at > now() - interval '30 minutes' and s.investigation_id is null
    group by s.coingecko_id`;
  let opened = 0;
  for (const c of scores) {
    const score = Number(c.score);
    if (score < (c.is_demo ? INVESTIGATION_SCORE_DEMO : INVESTIGATION_SCORE)) continue;
    const [recent] = await sql`select 1 from investigations where coingecko_id = ${c.coingecko_id} and opened_at > now() - ${INVESTIGATION_COOLDOWN_MIN} * interval '1 minute'`;
    if (recent) continue;
    const [inv] = await sql<{ id: number }[]>`
      insert into investigations (coingecko_id, score, window_from, window_to, trigger_signal_ids)
      values (${c.coingecko_id}, ${score}, now() - interval '2 hours', now(), ${c.ids}) returning id`;
    await sql`update signals set investigation_id = ${inv.id}, status = 'investigating' where id = any(${c.ids})`;
    console.log(`[signals] investigation #${inv.id} opened for ${c.coingecko_id} (score ${score.toFixed(1)}, ${c.ids.length} signals)`);
    opened++;
  }
  return opened;
}

export async function runSignals(): Promise<number> {
  let total = 0;
  const found: string[] = [];
  for (const rule of RULES) {
    try {
      const rows = await rule.run();
      const n = await recordSignals(rows);
      total += n;
      if (rows.length) found.push(`${rule.kind}:${rows.length}`);
    } catch (err) {
      console.error(`[signals] ${rule.kind} failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  const opened = await queueInvestigations();
  if (found.length) console.log(`[signals] ${found.join(" ")} → ${total} new, ${opened} investigations opened`);
  return total;
}

export const demoTokens = env.demoTokens;
