-- Add the CCXT feeds to ingestion_health.

create or replace view ingestion_health as
with expected (feed, provider, endpoint, every_sec) as (
  values
    ('cg:markets',          'coingecko',        '/coins/markets',        60),
    ('ccxt:binance-1m',     'ccxt:binance',     'klines:1m',             60),
    ('ccxt:perps-1m',       'ccxt:binanceusdm', 'klines:1m',             60),
    ('cg:categories',       'coingecko',        '/coins/categories',     300),
    ('ccxt:tickers',        'ccxt:binance',     'fetchTickers:spot',     300),
    ('ccxt:funding',        'ccxt:binanceusdm', 'fetchFundingRates',     300),
    ('ccxt:open-interest',  'ccxt:binanceusdm', 'openInterestHist:5m',   300),
    ('ccxt:sentiment',      'ccxt:binanceusdm', 'futuresSentiment:5m',   300),
    ('cg:global',           'coingecko',        '/global',               600),
    ('cg:trending',         'coingecko',        '/search/trending',      600),
    ('cg:derivatives',      'coingecko',        '/derivatives',          900),
    ('cg:key',              'coingecko',        '/key',                  3600),
    ('cg:coin-details',     'coingecko',        '/coins/{id}',           86400),
    ('cg:coins-list',       'coingecko',        '/coins/list',           86400),
    ('ccxt:symbol-map',     'ccxt:binance',     'loadMarkets',           86400)
),
stats as (
  select a.provider, a.endpoint,
         max(a.started_at) filter (where a.ok)                                   as last_success,
         max(a.started_at) filter (where not a.ok)                               as last_failure,
         count(*) filter (where a.started_at > now() - interval '1 hour')        as calls_1h,
         count(*) filter (where not a.ok and a.started_at > now() - interval '1 hour') as failures_1h,
         coalesce(sum(a.row_count) filter (where a.started_at > now() - interval '1 hour'), 0) as rows_1h,
         round(avg(a.latency_ms) filter (where a.started_at > now() - interval '1 hour')) as avg_latency_ms_1h,
         count(a.raw_path) filter (where a.started_at > now() - interval '1 hour') as archived_1h
  from api_calls a
  where a.started_at > now() - interval '3 days'
  group by a.provider, a.endpoint
)
select e.feed, e.every_sec,
       s.last_success,
       extract(epoch from now() - s.last_success)::int as age_sec,
       case
         when s.last_success is null then 'down'
         when now() - s.last_success <= make_interval(secs => e.every_sec * 2) then 'ok'
         when now() - s.last_success <= make_interval(secs => e.every_sec * 5) then 'late'
         else 'down'
       end as status,
       coalesce(s.calls_1h, 0)    as calls_1h,
       coalesce(s.failures_1h, 0) as failures_1h,
       coalesce(s.rows_1h, 0)     as rows_1h,
       s.avg_latency_ms_1h,
       coalesce(s.archived_1h, 0) as archived_1h,
       s.last_failure
from expected e
left join stats s on s.provider = e.provider and s.endpoint = e.endpoint
order by e.every_sec, e.feed;

revoke all on ingestion_health from anon, authenticated;
