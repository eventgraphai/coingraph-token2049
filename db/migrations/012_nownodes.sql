-- Onchain evidence from NOWNodes (Ethereum, BNB Chain, Bitcoin, Solana, Cardano — all mainnet).
-- Every row keys on the same coingecko_id as the CoinGecko and CCXT tables.

-- Token contracts per chain for the tracked universe (the onchain equivalent of symbol_map).
create table onchain_contracts (
  coingecko_id   text not null references tokens (coingecko_id),
  chain          text not null,               -- eth | bsc | sol | ada
  address        text not null,               -- lowercase for EVM chains
  decimals       int,
  symbol         text,
  name           text,
  source         text,                        -- coingecko | blockbook
  updated_at     timestamptz not null default now(),
  primary key (coingecko_id, chain)
);
create index onchain_contracts_addr_idx on onchain_contracts (chain, address);

-- Known wallets (exchanges, burn addresses…) used to tag transfers. Public labels, checked against the
-- chain (transaction count / balance) before use.
create table wallet_labels (
  chain          text not null,
  address        text not null,
  entity         text not null,               -- binance | okx | coinbase | bybit | kraken | gate | … | burn
  label          text,                        -- e.g. "Binance 14"
  kind           text not null default 'exchange', -- exchange | burn | bridge | contract
  source         text,
  confidence     text not null default 'high',
  active         boolean not null default true,
  tx_count       bigint,
  balance_native numeric,
  verified_at    timestamptz,
  primary key (chain, address)
);

-- Per token per 15-minute window: everything that moved onchain, summarised. Built from all transfers.
create table onchain_flow_snapshots (
  coingecko_id         text not null references tokens (coingecko_id),
  chain                text not null,
  window_start         timestamptz not null,
  transfer_count       int not null default 0,
  volume               numeric not null default 0,   -- token units
  volume_usd           numeric,
  unique_senders       int,
  unique_receivers     int,
  exchange_inflow_usd  numeric not null default 0,   -- sent to known exchange wallets
  exchange_outflow_usd numeric not null default 0,   -- sent from known exchange wallets
  exchange_net_usd     numeric not null default 0,   -- inflow - outflow (positive = coins arriving on exchanges)
  large_transfer_count int not null default 0,
  mint_usd             numeric not null default 0,
  burn_usd             numeric not null default 0,
  price_usd            numeric,                      -- price used for USD values
  from_block           bigint,
  to_block             bigint,
  api_call_id          bigint references api_calls (id),
  updated_at           timestamptz not null default now(),
  primary key (coingecko_id, chain, window_start)
);
create index onchain_flow_window_idx on onchain_flow_snapshots (window_start desc);

-- Individual large transfers (≥ threshold USD) with exchange tags. Native coins use log_index 0..n per tx.
create table onchain_transfers (
  chain          text not null,
  tx_hash        text not null,
  log_index      int not null default 0,
  block_number   bigint,
  block_ts       timestamptz not null,
  coingecko_id   text references tokens (coingecko_id),
  contract       text,
  from_address   text,
  to_address     text,
  amount         numeric not null,
  amount_usd     numeric,
  from_entity    text,                        -- wallet_labels.entity when known
  to_entity      text,
  direction      text not null,               -- to_exchange | from_exchange | exchange_internal | mint | burn | other
  pending        boolean not null default false,
  api_call_id    bigint references api_calls (id),
  investigation_id bigint,
  primary key (chain, tx_hash, log_index)
);
create index onchain_transfers_token_ts_idx on onchain_transfers (coingecko_id, block_ts desc);
create index onchain_transfers_ts_idx on onchain_transfers (block_ts desc);

-- Balances of known exchange wallets (native coin + every tracked token), hourly.
create table exchange_reserve_snapshots (
  captured_at    timestamptz not null,
  chain          text not null,
  wallet         text not null,
  entity         text not null,
  coingecko_id   text references tokens (coingecko_id),
  balance        numeric not null,
  balance_usd    numeric,
  api_call_id    bigint references api_calls (id),
  primary key (captured_at, chain, wallet, coingecko_id)
);
create index exchange_reserve_token_idx on exchange_reserve_snapshots (coingecko_id, captured_at desc);

-- Network fee / congestion samples (EVM chains).
create table chain_fee_snapshots (
  captured_at          timestamptz not null,
  chain                text not null,
  block_number         bigint,
  base_fee_gwei        numeric,
  priority_fee_p25_gwei numeric,
  priority_fee_p50_gwei numeric,
  priority_fee_p75_gwei numeric,
  gas_used_ratio       numeric,               -- 0..1 average over the sampled blocks (block fullness)
  blocks_sampled       int,
  api_call_id          bigint references api_calls (id),
  primary key (captured_at, chain)
);

-- Bitcoin: one row per block.
create table btc_block_snapshots (
  height               bigint primary key,
  block_hash           text,
  block_ts             timestamptz not null,
  tx_count             int,
  total_output_btc     numeric,
  total_output_usd     numeric,
  fees_btc             numeric,
  size_bytes           bigint,
  large_transfer_count int,
  exchange_inflow_usd  numeric,
  exchange_outflow_usd numeric,
  api_call_id          bigint references api_calls (id)
);

-- Bitcoin mempool (pending transactions) and fee estimates.
create table btc_mempool_snapshots (
  captured_at      timestamptz primary key,
  tx_count         int,
  bytes            bigint,
  total_fee_btc    numeric,
  min_fee_sat_vb   numeric,
  fee_1_block_sat_vb numeric,
  fee_3_blocks_sat_vb numeric,
  fee_6_blocks_sat_vb numeric,
  info             jsonb,
  api_call_id      bigint references api_calls (id)
);

-- Holder concentration (Solana, Cardano), daily.
create table token_holder_snapshots (
  coingecko_id   text not null references tokens (coingecko_id),
  chain          text not null,
  captured_at    timestamptz not null,
  supply         numeric,
  top10_pct      numeric,
  top20_pct      numeric,
  holders        jsonb,                       -- [{address, amount}] largest first
  api_call_id    bigint references api_calls (id),
  primary key (coingecko_id, chain, captured_at)
);

-- NOWNodes node health (public monitoring API).
create table nownodes_node_status (
  captured_at    timestamptz not null,
  chain          text not null,
  interface      text not null,               -- eth, eth-blockbook, eth-archive, bsc, btc, sol, ada-blockfrost …
  status         text,
  height         bigint,
  height_deviation int,
  primary key (captured_at, interface)
);

-- Where each scanner stopped, so restarts resume with no gaps.
create table onchain_scan_cursors (
  chain          text not null,
  feed           text not null,
  cursor         bigint not null,             -- block height (EVM/BTC) or unix seconds (Cardano)
  updated_at     timestamptz not null default now(),
  primary key (chain, feed)
);

alter table onchain_contracts enable row level security;
alter table wallet_labels enable row level security;
alter table onchain_flow_snapshots enable row level security;
alter table onchain_transfers enable row level security;
alter table exchange_reserve_snapshots enable row level security;
alter table chain_fee_snapshots enable row level security;
alter table btc_block_snapshots enable row level security;
alter table btc_mempool_snapshots enable row level security;
alter table token_holder_snapshots enable row level security;
alter table nownodes_node_status enable row level security;
alter table onchain_scan_cursors enable row level security;

-- ingestion_health: add the NOWNodes feeds.
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
    ('nn:exchange-reserves','nownodes',         'eth:/address/{wallet}', 3600),
    ('cg:exchange-tickers', 'coingecko',        '/coins/{id}/tickers',   86400),
    ('cg:treasuries',       'coingecko',        '/{entity}/public_treasury/{coin_id}', 86400),
    ('cg:global',           'coingecko',        '/global',               600),
    ('cg:trending',         'coingecko',        '/search/trending',      600),
    ('cg:derivatives',      'coingecko',        '/derivatives',          900),
    ('cg:key',              'coingecko',        '/key',                  3600),
    ('cg:coin-details',     'coingecko',        '/coins/{id}',           86400),
    ('cg:coins-list',       'coingecko',        '/coins/list',           86400),
    ('ccxt:symbol-map',     'ccxt:binance',     'loadMarkets',           86400),
    ('nn:holders',          'nownodes',         'sol:getTokenLargestAccounts', 86400)
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
