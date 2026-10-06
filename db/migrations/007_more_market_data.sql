-- Additional market data: liquidations, DEX pool tracking, scheduled exchange tickers,
-- exchange status, public treasuries. Long/short ratios from OKX/Bybit reuse futures_sentiment_snapshots;
-- periodic order books reuse order_book_snapshots.

-- Forced liquidations streamed live from Binance (!forceOrder@arr) and OKX (liquidation-orders).
create table liquidations (
  id             bigserial primary key,
  venue          text not null,
  symbol         text not null,           -- exchange-native, e.g. AAVEUSDT / AAVE-USDT-SWAP
  coingecko_id   text references tokens (coingecko_id),
  side           text,                    -- side of the liquidation order: SELL = long liquidated, BUY = short liquidated
  position_side  text,                    -- long | short when the venue reports it
  order_type     text,
  time_in_force  text,
  status         text,
  price          numeric,
  avg_price      numeric,
  quantity       numeric,                 -- base units (OKX: contracts × contract size)
  filled_qty     numeric,
  notional_usd   numeric,                 -- avg_price (or price) × quantity
  event_ts       timestamptz not null,
  received_at    timestamptz not null default now(),
  info           jsonb not null,
  unique (venue, symbol, event_ts, side, quantity)
);
create index liquidations_token_ts_idx on liquidations (coingecko_id, event_ts desc);
create index liquidations_ts_idx on liquidations (event_ts desc);

-- DEX pools for tracked tokens (demo coins every 15 min) and for investigations.
create table dex_pool_snapshots (
  id                                bigserial primary key,
  captured_at                       timestamptz not null,
  api_call_id                       bigint references api_calls (id),
  investigation_id                  bigint,
  coingecko_id                      text references tokens (coingecko_id),
  network                           text not null,
  token_address                     text not null,
  pool_address                      text not null,
  name                              text,
  dex_id                            text,
  base_token_id                     text,
  quote_token_id                    text,
  pool_created_at                   timestamptz,
  base_token_price_usd              numeric,
  base_token_price_native_currency  numeric,
  quote_token_price_usd             numeric,
  quote_token_price_native_currency numeric,
  base_token_price_quote_token      numeric,
  quote_token_price_base_token      numeric,
  token_price_usd                   numeric,
  fdv_usd                           numeric,
  market_cap_usd                    numeric,
  reserve_in_usd                    numeric,
  price_change_percentage           jsonb,   -- {m5, m15, m30, h1, h6, h24}
  volume_usd                        jsonb,   -- {m5 … h24}
  transactions                      jsonb,   -- {m5 … h24: {buys, sells, buyers, sellers}}
  volume_usd_m15                    numeric,
  volume_usd_h1                     numeric,
  volume_usd_h24                    numeric,
  buys_m15                          int,
  sells_m15                         int,
  buys_h1                           int,
  sells_h1                          int,
  buyers_h1                         int,
  sellers_h1                        int,
  attributes                        jsonb,   -- full attributes object as returned
  relationships                     jsonb
);
create index dex_pool_snapshots_token_time_idx on dex_pool_snapshots (coingecko_id, captured_at desc);

-- Exchange tickers per coin across 100+ exchanges (trust score, spread, ±2% depth, anomaly flags).
create table exchange_tickers (
  id                        bigserial primary key,
  captured_at               timestamptz not null,
  api_call_id               bigint references api_calls (id),
  investigation_id          bigint,
  coingecko_id              text references tokens (coingecko_id),
  base                      text,
  target                    text,
  market_name               text,
  market_identifier         text,
  has_trading_incentive     boolean,
  last                      numeric,
  volume                    numeric,
  converted_last            jsonb,
  converted_volume          jsonb,
  converted_volume_usd      numeric,
  cost_to_move_up_usd       numeric,
  cost_to_move_down_usd     numeric,
  trust_score               text,
  bid_ask_spread_percentage numeric,
  ticker_ts                 timestamptz,
  last_traded_at            timestamptz,
  last_fetch_at             timestamptz,
  is_anomaly                boolean,
  is_stale                  boolean,
  trade_url                 text,
  token_info_url            text,
  coin_id                   text,
  target_coin_id            text,
  coin_mcap_usd             numeric
);
create index exchange_tickers_token_time_idx on exchange_tickers (coingecko_id, captured_at desc);

-- Exchange availability (maintenance windows), so frozen prices are not mistaken for signals.
create table exchange_status (
  id          bigserial primary key,
  captured_at timestamptz not null,
  api_call_id bigint references api_calls (id),
  venue       text not null,
  status      text,
  updated     timestamptz,
  eta         timestamptz,
  url         text,
  info        jsonb
);
create index exchange_status_venue_time_idx on exchange_status (venue, captured_at desc);

-- Crypto held by public companies and governments (CoinGecko public treasury).
create table public_treasury_snapshots (
  id                   bigserial primary key,
  captured_at          timestamptz not null,
  api_call_id          bigint references api_calls (id),
  entity_type          text not null,       -- companies | governments
  coingecko_id         text not null,       -- bitcoin | ethereum | solana …
  total_holdings       numeric,
  total_value_usd      numeric,
  market_cap_dominance numeric,
  holders_count        int,
  holders              jsonb                 -- full list as returned
);
create index public_treasury_coin_time_idx on public_treasury_snapshots (coingecko_id, entity_type, captured_at desc);

alter table liquidations enable row level security;
alter table dex_pool_snapshots enable row level security;
alter table exchange_tickers enable row level security;
alter table exchange_status enable row level security;
alter table public_treasury_snapshots enable row level security;
