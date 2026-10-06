import { sql } from "./db";
import { CATEGORY_LABEL, JOB_SCHEDULE, jobTimeoutMs, nextRunAt, type Category } from "./jobs-meta";

// Read-only queries behind the /status dashboard.

// Which category and venues each ingestion_health feed belongs to.
const FEED_INFO: Record<string, { category: Category; venues: string }> = {
  "cg:markets": { category: "market", venues: "CoinGecko" },
  "cg:global": { category: "market", venues: "CoinGecko" },
  "cg:categories": { category: "market", venues: "CoinGecko" },
  "cg:trending": { category: "market", venues: "CoinGecko" },
  "cg:dex-pools": { category: "market", venues: "CoinGecko onchain" },
  "cg:exchange-tickers": { category: "market", venues: "CoinGecko" },
  "cg:treasuries": { category: "market", venues: "CoinGecko" },
  "cg:coin-details": { category: "market", venues: "CoinGecko" },
  "cg:coins-list": { category: "market", venues: "CoinGecko" },
  "cg:key": { category: "maintenance", venues: "CoinGecko" },
  "cg:derivatives": { category: "futures", venues: "CoinGecko" },
  "ccxt:binance-1m": { category: "spot", venues: "Binance" },
  "ccxt:perps-1m": { category: "futures", venues: "Binance futures" },
  "ccxt:tickers": { category: "spot", venues: "7 venues" },
  "ccxt:order-books": { category: "spot", venues: "Binance, OKX, Bybit…" },
  "ccxt:symbol-map": { category: "spot", venues: "7 venues" },
  "ccxt:funding": { category: "futures", venues: "Binance, OKX, Bybit" },
  "ccxt:open-interest": { category: "futures", venues: "Binance futures" },
  "ccxt:okx-bybit-oi": { category: "futures", venues: "OKX, Bybit" },
  "ccxt:sentiment": { category: "futures", venues: "Binance futures" },
  "ccxt:okx-bybit-ls": { category: "futures", venues: "OKX, Bybit" },
  "okx:liquidations": { category: "futures", venues: "OKX" },
  "ccxt:exchange-status": { category: "maintenance", venues: "5 venues" },
  "nn:eth-flows": { category: "onchain", venues: "Ethereum" },
  "nn:bsc-flows": { category: "onchain", venues: "BNB Chain" },
  "nn:fees": { category: "onchain", venues: "Ethereum, BNB Chain" },
  "nn:btc-blocks": { category: "onchain", venues: "Bitcoin" },
  "nn:btc-mempool": { category: "onchain", venues: "Bitcoin" },
  "nn:ada-transfers": { category: "onchain", venues: "Cardano" },
  "nn:exchange-reserves": { category: "onchain", venues: "Ethereum, BNB Chain" },
  "nn:node-status": { category: "onchain", venues: "NOWNodes" },
  "nn:holders": { category: "onchain", venues: "Solana" },
  "news:rss": { category: "market", venues: "CoinDesk, Cointelegraph, Decrypt, The Block" },
  "fng:index": { category: "market", venues: "alternative.me" },
  "llama:tvl": { category: "market", venues: "DefiLlama" },
};

export type Level = "ok" | "late" | "down";

export type Feed = {
  feed: string;
  every_sec: number;
  status: Level;
  age_sec: number | null;
  calls_1h: number;
  failures_1h: number;
  rows_1h: number;
  avg_latency_ms_1h: number | null;
  category: Category;
  venues: string;
  credits_24h: number | null;
};

export type JobRow = {
  job: string;
  label: string;
  category: Category;
  every_sec: number;
  next_run: Date;
  timeout_ms: number;
  runs_24h: number;
  ok_24h: number;
  failed_1h: number;
  failed_24h: number;
  success_pct: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  headroom_pct: number | null; // p95 as % of the job's time limit
  last_run: Date | null;
  last_ok: Date | null;
  last_status: string | null;
  last_error: string | null;
  last_rows: number | null;
  median_rows: number | null;
  running_now: boolean;
};

export type Venue = { provider: string; calls_1h: number; failed_1h: number; p50_ms: number | null; last_ok: Date | null; last_error: string | null };

export type Heartbeat = {
  worker_id: string;
  hostname: string;
  pid: number;
  started_at: Date;
  last_beat: Date;
  jobs_running: string[];
  meta: { node?: string; rss_mb?: number; pool?: string } | null;
};

export type Failure = { at: Date; source: string; what: string; error: string };
export type Freshness = { name: string; newest: Date | null; rows: number; cadence: string };
export type RunCell = { job: string; minute: Date; status: string };

export async function loadStatus() {
  const [
    feeds, jobStats, venues, credits24h, heartbeats, failures, freshness, runs,
    cgCoverage, cgMissing, candleCoverage, futuresCoverage, demoGrid, budget, metrics, connections,
  ] = await Promise.all([
    sql`select feed, every_sec, status, age_sec, calls_1h::int, failures_1h::int, rows_1h::int, avg_latency_ms_1h::int from ingestion_health`,

    sql`
      with r as (select * from job_runs where started_at > now() - interval '24 hours'),
      -- Latest *finished* run drives status and row checks; an in-progress run is reported separately.
      last as (select distinct on (job) job, status, error, rows, started_at from job_runs where status in ('ok', 'failed', 'timeout') order by job, started_at desc)
      select r.job,
             count(*)::int as runs_24h,
             count(*) filter (where r.status = 'ok')::int as ok_24h,
             count(*) filter (where r.status in ('ok', 'failed', 'timeout'))::int as finished_24h,
             count(*) filter (where r.status in ('failed','timeout') and r.started_at > now() - interval '1 hour')::int as failed_1h,
             count(*) filter (where r.status in ('failed','timeout'))::int as failed_24h,
             round(percentile_cont(0.5) within group (order by r.duration_ms) filter (where r.status = 'ok'))::int as p50_ms,
             round(percentile_cont(0.95) within group (order by r.duration_ms) filter (where r.status = 'ok'))::int as p95_ms,
             max(r.duration_ms)::int as max_ms,
             round(percentile_cont(0.5) within group (order by r.rows) filter (where r.status = 'ok'))::int as median_rows,
             max(r.started_at) filter (where r.status = 'ok') as last_ok,
             max(r.started_at) as last_run, max(l.status) as last_status, max(l.error) as last_error, max(l.rows) as last_rows,
             bool_or(r.status = 'running' and r.started_at > now() - interval '25 minutes') as running_now
      from r left join last l using (job)
      group by r.job`,

    sql`
      select provider, count(*)::int as calls_1h, count(*) filter (where ok = false)::int as failed_1h,
             round(percentile_cont(0.5) within group (order by latency_ms))::int as p50_ms,
             max(started_at) filter (where ok) as last_ok,
             (array_agg(left(error, 160) order by started_at desc) filter (where ok = false))[1] as last_error
      from api_calls where started_at > now() - interval '1 hour'
      group by provider order by provider`,

    sql`select endpoint, count(*)::int as calls from api_calls where provider = 'coingecko' and started_at > now() - interval '24 hours' group by endpoint`,

    sql`select worker_id, hostname, pid, started_at, last_beat, jobs_running, meta from worker_heartbeats order by last_beat desc limit 5`,

    sql`
      (select started_at as at, 'job' as source, job as what, coalesce(error, status) as error
         from job_runs where status in ('failed', 'timeout') and started_at > now() - interval '24 hours')
      union all
      (select started_at as at, provider as source, endpoint as what, coalesce(error, 'failed') as error
         from api_calls where ok = false and started_at > now() - interval '24 hours')
      order by at desc limit 40`,

    sql`
      select * from (values
        ('market_snapshots',            (select max(captured_at) from market_snapshots),           'CoinGecko · 1 min'),
        ('cex_ohlcv',                   (select max(ts) from cex_ohlcv where ts > now() - interval '1 day'), 'Exchanges · 1 min'),
        ('order_book_snapshots',        (select max(captured_at) from order_book_snapshots),       'Demo coins · 5 min'),
        ('cex_ticker_snapshots',        (select max(captured_at) from cex_ticker_snapshots),       'Exchanges · 5 min'),
        ('funding_rate_snapshots',      (select max(captured_at) from funding_rate_snapshots),     'Futures · 5 min'),
        ('open_interest_snapshots',     (select max(exchange_ts) from open_interest_snapshots),    'Futures · 5 min'),
        ('futures_sentiment_snapshots', (select max(ts) from futures_sentiment_snapshots),         'Futures · 5 min'),
        ('liquidations',                (select max(event_ts) from liquidations),                  'OKX · 5 min'),
        ('category_snapshots',          (select max(captured_at) from category_snapshots),         'CoinGecko · 5 min'),
        ('global_snapshots',            (select max(captured_at) from global_snapshots),           'CoinGecko · 10 min'),
        ('trending_snapshots',          (select max(captured_at) from trending_snapshots),         'CoinGecko · 10 min'),
        ('dex_pool_snapshots',          (select max(captured_at) from dex_pool_snapshots),         'CoinGecko · 15 min'),
        ('derivatives_tickers',         (select max(captured_at) from derivatives_tickers),        'CoinGecko · 15 min'),
        ('onchain_flow_snapshots',      (select max(window_start) from onchain_flow_snapshots),    'NOWNodes · 15 min'),
        ('onchain_transfers',           (select max(block_ts) from onchain_transfers),             'NOWNodes · 15 min'),
        ('btc_block_snapshots',         (select max(block_ts) from btc_block_snapshots),           'NOWNodes · per block'),
        ('btc_mempool_snapshots',       (select max(captured_at) from btc_mempool_snapshots),      'NOWNodes · 15 min'),
        ('chain_fee_snapshots',         (select max(captured_at) from chain_fee_snapshots),        'NOWNodes · 15 min'),
        ('exchange_reserve_snapshots',  (select max(captured_at) from exchange_reserve_snapshots), 'NOWNodes · hourly'),
        ('token_holder_snapshots',      (select max(captured_at) from token_holder_snapshots),     'NOWNodes · daily'),
        ('news_items',                  (select max(published_at) from news_items),                'RSS · 15 min'),
        ('protocol_tvl_snapshots',      (select max(captured_at) from protocol_tvl_snapshots),     'DefiLlama · 360 min'),
        ('market_sentiment_snapshots',  (select max(captured_at) from market_sentiment_snapshots), 'Fear & Greed · daily'),
        ('exchange_tickers',            (select max(captured_at) from exchange_tickers),           'CoinGecko · daily'),
        ('coin_detail_snapshots',       (select max(captured_at) from coin_detail_snapshots),      'CoinGecko · daily')
      ) t(name, newest, cadence)
      join lateral (select coalesce(c.reltuples, 0)::bigint as rows from pg_class c where c.relname = t.name and c.relkind = 'r') r on true`,

    sql`
      select job, date_trunc('minute', started_at) as minute,
             case when bool_or(status in ('failed', 'timeout')) then 'failed'
                  when bool_or(status = 'running') then 'running' else 'ok' end as status
      from job_runs where started_at > now() - interval '60 minutes'
      group by job, date_trunc('minute', started_at)`,

    // Coverage: CoinGecko top 100.
    sql`
      with u as (select coingecko_id from tokens where in_universe),
      m as (select coingecko_id, count(distinct date_trunc('minute', captured_at)) as minutes, max(captured_at) as last
            from market_snapshots where captured_at > now() - interval '60 minutes' group by 1)
      select (select count(*) from u)::int as universe,
             count(*) filter (where m.last > now() - interval '10 minutes')::int as fresh_10m,
             round(avg(coalesce(m.minutes, 0)) / 60.0 * 100, 1)::float as minute_coverage_pct
      from u left join m using (coingecko_id)`,
    sql`
      select upper(t.symbol) as symbol, t.coingecko_id, max(s.captured_at) as last
      from tokens t left join market_snapshots s on s.coingecko_id = t.coingecko_id and s.captured_at > now() - interval '1 day'
      where t.in_universe group by 1, 2 having coalesce(max(s.captured_at), 'epoch') < now() - interval '15 minutes'
      order by 3 nulls first limit 12`,

    // Coverage: 1-minute candle series on primary venues.
    sql`
      with expected as (select m.venue, m.symbol from symbol_map m join tokens t using (coingecko_id) where m.is_primary and m.price_check_ok and t.in_universe),
      c as (select venue, symbol, count(*) as n, max(ts) as last from cex_ohlcv where ts > now() - interval '61 minutes' and ts < date_trunc('minute', now()) group by 1, 2)
      select count(*)::int as expected,
             count(*) filter (where c.last > now() - interval '5 minutes')::int as fresh,
             count(*) filter (where c.n >= 58)::int as complete_hour,
             count(*) filter (where coalesce(c.n, 0) < 58)::int as incomplete_hour
      from expected e left join c using (venue, symbol)`,

    // Coverage: futures per venue (mapped perps vs symbols seen recently).
    sql`
      with mapped as (select m.venue, m.symbol from symbol_map m join tokens t using (coingecko_id) where m.market_type = 'swap' and m.price_check_ok and t.in_universe and m.venue in ('binanceusdm','okx','bybit'))
      select m.venue,
             count(*)::int as mapped,
             count(*) filter (where exists (select 1 from open_interest_snapshots o where o.venue = m.venue and o.symbol = m.symbol and o.exchange_ts > now() - interval '20 minutes'))::int as oi_fresh,
             count(*) filter (where exists (select 1 from funding_rate_snapshots f where f.venue = m.venue and f.symbol = m.symbol and f.captured_at > now() - interval '20 minutes'))::int as funding_fresh,
             count(*) filter (where exists (select 1 from futures_sentiment_snapshots s where s.venue = m.venue and s.symbol = m.symbol and s.ts > now() - interval '30 minutes'))::int as positioning_fresh
      from mapped m group by m.venue order by m.venue`,

    // Demo coins: age of each data type.
    sql`
      select t.coingecko_id, upper(t.symbol) as symbol,
        (select max(captured_at) from market_snapshots where coingecko_id = t.coingecko_id) as coingecko,
        (select max(c.ts) from cex_ohlcv c join symbol_map m on m.venue = c.venue and m.symbol = c.symbol and m.is_primary and m.market_type = 'spot'
           where c.coingecko_id = t.coingecko_id and c.ts > now() - interval '1 day') as spot_1m,
        (select max(c.ts) from cex_ohlcv c join symbol_map m on m.venue = c.venue and m.symbol = c.symbol and m.is_primary and m.market_type = 'swap'
           where c.coingecko_id = t.coingecko_id and c.ts > now() - interval '1 day') as perp_1m,
        (select max(captured_at) from funding_rate_snapshots where coingecko_id = t.coingecko_id) as funding,
        (select max(exchange_ts) from open_interest_snapshots where coingecko_id = t.coingecko_id) as open_interest,
        (select max(ts) from futures_sentiment_snapshots where coingecko_id = t.coingecko_id) as positioning,
        (select max(captured_at) from order_book_snapshots where coingecko_id = t.coingecko_id) as order_book,
        (select max(captured_at) from dex_pool_snapshots where coingecko_id = t.coingecko_id) as dex_pools,
        (select max(event_ts) from liquidations where coingecko_id = t.coingecko_id) as last_liquidation
      from tokens t where t.is_demo order by t.market_cap_rank`,

    // Budget: CoinGecko credits.
    sql`
      select (select credits_remaining from api_calls where endpoint = '/key' and credits_remaining is not null order by id desc limit 1) as remaining,
             (select started_at from api_calls where endpoint = '/key' and credits_remaining is not null order by id desc limit 1) as checked_at,
             (select count(*) from api_calls where provider = 'coingecko' and started_at > now() - interval '24 hours')::int as used_24h,
             (select count(*) from api_calls where provider = 'coingecko' and started_at > date_trunc('day', now()))::int as used_today,
             (select count(*) from api_calls where provider = 'nownodes' and endpoint not like 'watcher:%' and started_at > date_trunc('month', now()))::int as nn_month,
             (select count(*) from api_calls where provider = 'nownodes' and endpoint not like 'watcher:%' and started_at > now() - interval '24 hours')::int as nn_24h,
             (select jsonb_object_agg(chain, n) from (
                select split_part(endpoint, ':', 1) as chain, count(*) as n from api_calls
                where provider = 'nownodes' and endpoint not like 'watcher:%' and started_at > now() - interval '24 hours' group by 1) c) as nn_by_chain`,

    sql`select captured_at, db_size_bytes, credits_remaining, table_sizes from system_metrics where captured_at > now() - interval '7 days' order by captured_at`,

    sql`
      select (select count(*) from pg_stat_activity where datname = current_database())::int as connections,
             current_setting('max_connections')::int as max_connections,
             pg_database_size(current_database()) as db_bytes,
             (select jsonb_object_agg(relname, size) from (
                select relname, pg_total_relation_size(relid) as size from pg_stat_user_tables order by 2 desc limit 6) t) as largest`,
  ]);

  const now = new Date();

  // Feeds with category, venues and CoinGecko credits used.
  const creditsByEndpoint = new Map(credits24h.map((c) => [c.endpoint as string, c.calls as number]));
  const feedEndpoint: Record<string, string> = Object.fromEntries(JOB_SCHEDULE.filter((j) => j.endpoint?.startsWith("coingecko|")).map((j) => [j.name, j.endpoint!.split("|")[1]]));
  feedEndpoint["cg:treasuries"] = "/{entity}/public_treasury/{coin_id}";
  feedEndpoint["cg:coin-details"] = "/coins/{id}";
  feedEndpoint["cg:coins-list"] = "/coins/list";
  feedEndpoint["cg:key"] = "/key";
  const feedRows: Feed[] = feeds.map((f) => {
    const info = FEED_INFO[f.feed as string] ?? { category: "maintenance" as Category, venues: "" };
    const endpoint = feedEndpoint[f.feed as string];
    return { ...(f as unknown as Feed), ...info, credits_24h: endpoint ? creditsByEndpoint.get(endpoint) ?? 0 : null };
  });

  // Jobs: schedule + 24h statistics.
  const statsByJob = new Map(jobStats.map((j) => [j.job as string, j]));
  const jobs: JobRow[] = JOB_SCHEDULE.map((m) => {
    const st = statsByJob.get(m.name);
    const timeout = jobTimeoutMs(m.everySec);
    const p95 = (st?.p95_ms as number | null) ?? null;
    return {
      job: m.name,
      label: m.label,
      category: m.category,
      every_sec: m.everySec,
      next_run: new Date(nextRunAt(m, now.getTime())),
      timeout_ms: timeout,
      runs_24h: (st?.runs_24h as number) ?? 0,
      ok_24h: (st?.ok_24h as number) ?? 0,
      failed_1h: (st?.failed_1h as number) ?? 0,
      failed_24h: (st?.failed_24h as number) ?? 0,
      // Success rate over finished runs only; an in-progress run is neither a success nor a failure yet.
      success_pct: st && (st.finished_24h as number) > 0 ? Math.round(((st.ok_24h as number) / (st.finished_24h as number)) * 1000) / 10 : null,
      p50_ms: (st?.p50_ms as number | null) ?? null,
      p95_ms: p95,
      max_ms: (st?.max_ms as number | null) ?? null,
      headroom_pct: p95 !== null ? Math.round((p95 / timeout) * 100) : null,
      last_run: (st?.last_run as Date | null) ?? null,
      last_ok: (st?.last_ok as Date | null) ?? null,
      last_status: (st?.last_status as string | null) ?? null,
      last_error: (st?.last_error as string | null) ?? null,
      last_rows: (st?.last_rows as number | null) ?? null,
      median_rows: (st?.median_rows as number | null) ?? null,
      running_now: Boolean(st?.running_now),
    };
  });

  // Budget & capacity.
  const b = budget[0];
  const remaining = (b?.remaining as number | null) ?? null;
  const burnPerDay = (b?.used_24h as number) ?? 0;
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const daysToMonthEnd = (monthEnd - now.getTime()) / 86_400_000;
  const conn = connections[0];
  const firstMetric = metrics[0];
  const lastMetric = metrics[metrics.length - 1];
  const spanDays = firstMetric && lastMetric ? (new Date(lastMetric.captured_at).getTime() - new Date(firstMetric.captured_at).getTime()) / 86_400_000 : 0;
  const growthPerDay = spanDays >= 0.25 ? (Number(lastMetric.db_size_bytes) - Number(firstMetric.db_size_bytes)) / spanDays : null;

  return {
    now,
    categories: CATEGORY_LABEL,
    feeds: feedRows,
    jobs,
    venues: venues as unknown as Venue[],
    heartbeats: heartbeats as unknown as Heartbeat[],
    failures: failures as unknown as Failure[],
    freshness: freshness as unknown as Freshness[],
    runs: runs as unknown as RunCell[],
    coverage: {
      coingecko: cgCoverage[0] as unknown as { universe: number; fresh_10m: number; minute_coverage_pct: number },
      coingeckoMissing: cgMissing as unknown as { symbol: string; coingecko_id: string; last: Date | null }[],
      candles: candleCoverage[0] as unknown as { expected: number; fresh: number; complete_hour: number; incomplete_hour: number },
      futures: futuresCoverage as unknown as { venue: string; mapped: number; oi_fresh: number; funding_fresh: number; positioning_fresh: number }[],
      demo: demoGrid as unknown as Record<string, Date | string | null>[],
    },
    budget: {
      remaining,
      checkedAt: (b?.checked_at as Date | null) ?? null,
      usedToday: (b?.used_today as number) ?? 0,
      burnPerDay,
      daysLeft: remaining !== null && burnPerDay > 0 ? remaining / burnPerDay : null,
      projectedAtMonthEnd: remaining !== null ? Math.round(remaining - burnPerDay * daysToMonthEnd) : null,
      daysToMonthEnd,
      dbBytes: Number(conn?.db_bytes ?? 0),
      growthPerDay,
      metricsSince: firstMetric?.captured_at ?? null,
      largest: (conn?.largest ?? {}) as Record<string, number>,
      connections: (conn?.connections as number) ?? 0,
      maxConnections: (conn?.max_connections as number) ?? 0,
      nownodes: {
        plan: Number(process.env.NOWNODES_MONTHLY_REQUESTS ?? 100_000),
        usedMonth: (b?.nn_month as number) ?? 0,
        used24h: (b?.nn_24h as number) ?? 0,
        projectedMonth: Math.round(((b?.nn_24h as number) ?? 0) * (new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate())),
        byChain: ((b?.nn_by_chain ?? {}) as Record<string, number>),
      },
    },
  };
}

export type StatusData = Awaited<ReturnType<typeof loadStatus>>;
