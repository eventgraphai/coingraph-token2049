-- Operational tracking for the ingestion worker: one row per job run, a heartbeat per worker process,
-- and per-job health. Plus derived-USD views for venues that don't report USD values.

create table job_runs (
  id          bigserial primary key,
  worker_id   text not null,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',   -- running | ok | failed | timeout
  rows        int,
  duration_ms int,
  error       text
);
create index job_runs_job_time_idx on job_runs (job, started_at desc);
create index job_runs_time_idx on job_runs (started_at desc);

create table worker_heartbeats (
  worker_id    text primary key,
  hostname     text,
  pid          int,
  started_at   timestamptz not null,
  last_beat    timestamptz not null,
  jobs_running text[] not null default '{}',
  meta         jsonb
);

-- Latest state per job: last run, last success, recent failures and durations.
create view job_health as
with recent as (
  select job,
         count(*) filter (where started_at > now() - interval '1 hour')                                as runs_1h,
         count(*) filter (where status = 'ok' and started_at > now() - interval '1 hour')              as ok_1h,
         count(*) filter (where status in ('failed', 'timeout') and started_at > now() - interval '1 hour') as failed_1h,
         count(*) filter (where status in ('failed', 'timeout') and started_at > now() - interval '24 hours') as failed_24h,
         round(avg(duration_ms) filter (where status = 'ok' and started_at > now() - interval '1 hour')) as avg_ms_1h,
         max(duration_ms) filter (where started_at > now() - interval '1 hour')                       as max_ms_1h,
         max(started_at) filter (where status = 'ok')                                                  as last_ok,
         max(started_at)                                                                               as last_run
  from job_runs
  where started_at > now() - interval '2 days'
  group by job
)
select r.*, l.status as last_status, l.error as last_error, l.rows as last_rows, l.duration_ms as last_duration_ms
from recent r
join lateral (
  select status, error, rows, duration_ms from job_runs j where j.job = r.job order by started_at desc limit 1
) l on true
order by r.job;

-- Open interest in USD for every venue: reported value, else amount × the venue's latest mark price
-- at or before that time (Bybit reports contracts only).
create view open_interest_usd as
select o.venue, o.symbol, o.coingecko_id, o.exchange_ts, o.open_interest_amount, o.open_interest_value,
       coalesce(o.open_interest_value, o.open_interest_amount * f.mark_price) as open_interest_usd,
       case when o.open_interest_value is not null then 'reported' when f.mark_price is not null then 'derived:amount×mark' end as usd_source
from open_interest_snapshots o
left join lateral (
  select mark_price from funding_rate_snapshots f
  where f.venue = o.venue and f.symbol = o.symbol and f.captured_at <= o.exchange_ts + interval '5 minutes' and f.mark_price is not null
  order by f.captured_at desc limit 1
) f on true;

-- 1-minute candles with a USD (quote) volume for every venue: reported, else base volume × close.
create view cex_ohlcv_usd as
select c.*,
       coalesce(c.quote_volume, c.volume * c.close) as quote_volume_usd,
       case when c.quote_volume is not null then 'reported' else 'derived:volume×close' end as quote_volume_source
from cex_ohlcv c;

alter table job_runs enable row level security;
alter table worker_heartbeats enable row level security;
revoke all on job_health, open_interest_usd, cex_ohlcv_usd from anon, authenticated;
