-- CoinGraph: provenance + CoinGecko reference and snapshot tables.
-- Every field CoinGecko returns is stored: flat values as columns, nested objects as JSONB.
-- See docs/DATA_MODEL.md for the field-by-field mapping.

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

create table api_calls (
  id                bigserial primary key,
  provider          text not null,
  endpoint          text not null,
  params            jsonb,
  status_code       int,
  ok                boolean,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  latency_ms        int,
  response_bytes    int,
  row_count         int,
  raw_path          text,          -- object key of the gzipped raw response in storage
  credits_remaining int
);
create index api_calls_provider_endpoint_idx on api_calls (provider, endpoint, started_at desc);

-- ---------------------------------------------------------------------------
-- Reference tables (upserted, current state)
-- ---------------------------------------------------------------------------

create table coins (
  coingecko_id text primary key,
  symbol       text not null,
  name         text not null,
  platforms    jsonb not null default '{}',
  updated_at   timestamptz not null default now()
);
create index coins_symbol_idx on coins (lower(symbol));
create index coins_platforms_idx on coins using gin (platforms);

create table tokens (
  coingecko_id               text primary key,
  symbol                     text not null,
  name                       text not null,
  image                      jsonb,
  market_cap_rank            int,
  web_slug                   text,
  asset_platform_id          text,
  contract_address           text,
  platforms                  jsonb,
  detail_platforms           jsonb,
  block_time_in_minutes      int,
  hashing_algorithm          text,
  categories                 text[],
  description                text,
  links                      jsonb,
  country_origin             text,
  genesis_date               date,
  listing_price              numeric,
  listing_currency           text,
  listing_timestamp          timestamptz,
  listing_source             text,
  listing_source_url         text,
  preview_listing            boolean,
  has_supply_breakdown       boolean,
  public_notice              text,
  additional_notices         jsonb,
  status_updates             jsonb,
  detail_last_updated        timestamptz,
  is_stablecoin              boolean not null default false,
  is_demo                    boolean not null default false,
  in_universe                boolean not null default false,
  first_seen_at              timestamptz not null default now(),
  last_in_universe_at        timestamptz,
  updated_at                 timestamptz not null default now()
);
create index tokens_universe_idx on tokens (in_universe, market_cap_rank);

create table asset_platforms (
  id               text primary key,
  chain_identifier bigint,
  name             text,
  shortname        text,
  native_coin_id   text,
  image            jsonb,
  updated_at       timestamptz not null default now()
);

create table onchain_networks (
  id                          text primary key,
  name                        text,
  coingecko_asset_platform_id text,
  updated_at                  timestamptz not null default now()
);

create table categories (
  id         text primary key,
  name       text,
  content    text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Snapshot tables (time series)
-- ---------------------------------------------------------------------------

create table market_snapshots (
  id                               bigserial primary key,
  coingecko_id                     text not null references tokens (coingecko_id),
  captured_at                      timestamptz not null,
  api_call_id                      bigint references api_calls (id),
  current_price                    numeric,
  market_cap                       numeric,
  market_cap_rank                  int,
  fully_diluted_valuation          numeric,
  total_volume                     numeric,
  high_24h                         numeric,
  low_24h                          numeric,
  price_change_24h                 numeric,
  price_change_percentage_24h      numeric,
  market_cap_change_24h            numeric,
  market_cap_change_percentage_24h numeric,
  circulating_supply               numeric,
  total_supply                     numeric,
  max_supply                       numeric,
  ath                              numeric,
  ath_change_percentage            numeric,
  ath_date                         timestamptz,
  atl                              numeric,
  atl_change_percentage            numeric,
  atl_date                         timestamptz,
  roi                              jsonb,
  pct_change_1h                    numeric,
  pct_change_24h                   numeric,
  pct_change_7d                    numeric,
  pct_change_14d                   numeric,
  pct_change_30d                   numeric,
  pct_change_200d                  numeric,
  pct_change_1y                    numeric,
  cg_last_updated                  timestamptz,
  unique (coingecko_id, cg_last_updated)
);
create index market_snapshots_token_time_idx on market_snapshots (coingecko_id, captured_at desc);
create index market_snapshots_time_idx on market_snapshots (captured_at desc);

create table global_snapshots (
  id                                   bigserial primary key,
  captured_at                          timestamptz not null,
  api_call_id                          bigint references api_calls (id),
  active_cryptocurrencies              int,
  markets                              int,
  upcoming_icos                        int,
  ongoing_icos                         int,
  ended_icos                           int,
  total_market_cap_usd                 numeric,
  total_volume_usd                     numeric,
  total_market_cap                     jsonb,
  total_volume                         jsonb,
  market_cap_percentage                jsonb,
  btc_dominance                        numeric,
  eth_dominance                        numeric,
  market_cap_change_percentage_24h_usd numeric,
  volume_change_percentage_24h_usd     numeric,
  cg_updated_at                        timestamptz unique
);
create index global_snapshots_time_idx on global_snapshots (captured_at desc);

create table category_snapshots (
  id                    bigserial primary key,
  category_id           text not null references categories (id),
  captured_at           timestamptz not null,
  api_call_id           bigint references api_calls (id),
  market_cap            numeric,
  market_cap_change_24h numeric,
  volume_24h            numeric,
  top_3_coins_id        text[],
  top_3_coins           jsonb,
  cg_updated_at         timestamptz,
  unique (category_id, cg_updated_at)
);
create index category_snapshots_cat_time_idx on category_snapshots (category_id, captured_at desc);

create table trending_snapshots (
  id                             bigserial primary key,
  captured_at                    timestamptz not null,
  api_call_id                    bigint references api_calls (id),
  item_type                      text not null,   -- coin | category | nft | rwa
  position                       int not null,
  item_id                        text,
  coingecko_id                   text,
  name                           text,
  symbol                         text,
  slug                           text,
  market_cap_rank                int,
  score                          int,
  price_btc                      numeric,
  price_usd                      numeric,
  market_cap                     numeric,
  total_volume                   numeric,
  price_change_percentage_24h_usd numeric,
  market_cap_1h_change           numeric,
  coins_count                    int,
  images                         jsonb,
  data                           jsonb,
  item                           jsonb not null   -- the full item exactly as returned
);
create index trending_snapshots_time_idx on trending_snapshots (captured_at desc, item_type);

create table derivatives_tickers (
  id                          bigserial primary key,
  captured_at                 timestamptz not null,
  api_call_id                 bigint references api_calls (id),
  coingecko_id                text references tokens (coingecko_id),
  market                      text,
  symbol                      text,
  index_id                    text,
  price                       numeric,
  price_percentage_change_24h numeric,
  contract_type               text,
  index                       numeric,
  basis                       numeric,
  spread                      numeric,
  funding_rate                numeric,
  open_interest               numeric,
  volume_24h                  numeric,
  last_traded_at              timestamptz,
  expired_at                  timestamptz
);
create index derivatives_tickers_token_time_idx on derivatives_tickers (coingecko_id, captured_at desc);

create table coin_detail_snapshots (
  id                                 bigserial primary key,
  coingecko_id                       text not null references tokens (coingecko_id),
  captured_at                        timestamptz not null,
  api_call_id                        bigint references api_calls (id),
  market_cap_rank                    int,
  market_cap_rank_with_rehypothecated int,
  sentiment_votes_up_percentage      numeric,
  sentiment_votes_down_percentage    numeric,
  watchlist_portfolio_users          int,
  market_data                        jsonb,
  community_data                     jsonb,
  developer_data                     jsonb,
  cg_last_updated                    timestamptz
);
create index coin_detail_snapshots_token_time_idx on coin_detail_snapshots (coingecko_id, captured_at desc);

create table market_chart_points (
  coingecko_id text not null,
  granularity  text not null,     -- hourly | 5m
  ts           timestamptz not null,
  price        numeric,
  market_cap   numeric,
  total_volume numeric,
  api_call_id  bigint references api_calls (id),
  primary key (coingecko_id, granularity, ts)
);
