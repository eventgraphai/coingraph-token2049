-- External context feeds: news headlines (public RSS), Fear & Greed index, DefiLlama protocol TVL.
-- All keyed on coingecko_id like the rest of the database.

-- Headlines from crypto news RSS feeds, matched to coins by name / symbol. Title + link only (no article text).
create table news_items (
  id             bigserial primary key,
  source         text not null,             -- coindesk | cointelegraph | decrypt | theblock
  url            text not null,
  title          text not null,
  published_at   timestamptz not null,
  fetched_at     timestamptz not null default now(),
  coins          text[] not null default '{}', -- coingecko_ids mentioned in the title
  categories     text[],
  api_call_id    bigint references api_calls (id),
  unique (source, url)
);
create index news_items_published_idx on news_items (published_at desc);
create index news_items_coins_idx on news_items using gin (coins);

-- Crypto Fear & Greed index (alternative.me), one value per day.
create table market_sentiment_snapshots (
  day            date primary key,
  value          int not null,              -- 0 (extreme fear) … 100 (extreme greed)
  classification text,
  api_call_id    bigint references api_calls (id),
  captured_at    timestamptz not null default now()
);

-- DefiLlama TVL per protocol whose token is in the universe (several protocols can share a coin, e.g. Aave V2/V3).
create table protocol_tvl_snapshots (
  captured_at    timestamptz not null,
  coingecko_id   text not null references tokens (coingecko_id),
  protocol       text not null,             -- DefiLlama slug
  name           text,
  category       text,
  chains         text[],
  tvl_usd        numeric,
  change_1d_pct  numeric,
  change_7d_pct  numeric,
  mcap_usd       numeric,
  api_call_id    bigint references api_calls (id),
  primary key (captured_at, protocol)
);
create index protocol_tvl_coin_idx on protocol_tvl_snapshots (coingecko_id, captured_at desc);

alter table news_items enable row level security;
alter table market_sentiment_snapshots enable row level security;
alter table protocol_tvl_snapshots enable row level security;

-- ingestion_health: add the external feeds.
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
    ('ccxt:okx-bybit-oi',   'ccxt:okx',         'openInterestHistory:5m', 300),
    ('ccxt:okx-bybit-ls',   'ccxt:okx',         'longShortRatio:5m',     300),
    ('okx:liquidations',    'okx',              '/api/v5/public/liquidation-orders', 300),
    ('ccxt:order-books',    'ccxt:binance',     'fetchOrderBook',        300),
    ('ccxt:exchange-status','ccxt:binance',     'fetchStatus',           300),
    ('nn:node-status',      'nownodes',         'watcher:/networks/status', 300),
    ('nn:btc-blocks',       'nownodes',         'btc:/block/{height}',   600),
    ('cg:dex-pools',        'coingecko',        '/onchain/networks/{network}/tokens/{address}/pools', 900),
    ('nn:eth-flows',        'nownodes',         'eth:eth_getLogs',       900),
    ('nn:bsc-flows',        'nownodes',         'bsc:eth_getLogs',       900),
    ('nn:fees',             'nownodes',         'eth:eth_feeHistory',    900),
    ('nn:btc-mempool',      'nownodes',         'btc:getmempoolinfo',    900),
    ('nn:ada-transfers',    'nownodes',         'ada:graphql:transactions', 900),
    ('news:rss',            'rss',              'cointelegraph',         900),
    ('nn:exchange-reserves','nownodes',         'eth:/address/{wallet}', 3600),
    ('llama:tvl',           'defillama',        '/protocols',            21600),
    ('cg:exchange-tickers', 'coingecko',        '/coins/{id}/tickers',   86400),
    ('cg:treasuries',       'coingecko',        '/{entity}/public_treasury/{coin_id}', 86400),
    ('cg:global',           'coingecko',        '/global',               600),
    ('cg:trending',         'coingecko',        '/search/trending',      600),
    ('cg:derivatives',      'coingecko',        '/derivatives',          900),
    ('cg:key',              'coingecko',        '/key',                  3600),
    ('cg:coin-details',     'coingecko',        '/coins/{id}',           86400),
    ('cg:coins-list',       'coingecko',        '/coins/list',           86400),
    ('ccxt:symbol-map',     'ccxt:binance',     'loadMarkets',           86400),
    ('nn:holders',          'nownodes',         'sol:getTokenLargestAccounts', 86400),
    ('fng:index',           'alternative.me',   '/fng',                  86400)
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
