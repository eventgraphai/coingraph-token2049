-- CoinGraph: exchange data via CCXT (Binance spot + USDⓈ-M futures, OKX, Coinbase).
-- venue = CCXT exchange id ('binance' spot, 'binanceusdm' perps, 'okx', 'coinbase').
-- Every field the exchange returns is kept (typed columns + `info` JSONB with the raw exchange payload).

-- ---------------------------------------------------------------------------
-- Reference
-- ---------------------------------------------------------------------------

create table exchange_markets (
  venue          text not null,
  symbol         text not null,          -- CCXT unified symbol, e.g. AAVE/USDT, AAVE/USDT:USDT
  market_id      text,                   -- exchange-native id, e.g. AAVEUSDT
  base           text,
  quote          text,
  settle         text,
  base_id        text,
  quote_id       text,
  type           text,                   -- spot | swap | future | option
  spot           boolean,
  margin         boolean,
  swap           boolean,
  future         boolean,
  option         boolean,
  contract       boolean,
  linear         boolean,
  inverse        boolean,
  active         boolean,
  contract_size  numeric,
  expiry         timestamptz,
  strike         numeric,
  taker          numeric,
  maker          numeric,
  precision      jsonb,
  limits         jsonb,
  info           jsonb,
  updated_at     timestamptz not null default now(),
  primary key (venue, symbol)
);
create index exchange_markets_base_idx on exchange_markets (base, type);

-- Which exchange market represents which CoinGecko token (price-checked against CoinGecko).
create table symbol_map (
  coingecko_id     text not null references tokens (coingecko_id),
  venue            text not null,
  market_type      text not null,       -- spot | swap
  symbol           text not null,
  market_id        text not null,
  base             text not null,
  quote            text not null,
  price_multiplier numeric not null default 1,   -- 1000 for 1000SHIB-style contracts
  exchange_price   numeric,
  coingecko_price  numeric,
  price_deviation  numeric,             -- |exchange/multiplier ÷ coingecko − 1|
  price_check_ok   boolean not null,
  is_primary       boolean not null default false,  -- the venue we pull candles from for this token+type
  verified_at      timestamptz not null default now(),
  primary key (coingecko_id, venue, market_type)
);

-- ---------------------------------------------------------------------------
-- Time series
-- ---------------------------------------------------------------------------

-- 1-minute candles. Binance klines carry quote volume, trade count and taker-buy volume.
create table cex_ohlcv (
  venue                  text not null,
  market_type            text not null,
  symbol                 text not null,
  coingecko_id           text references tokens (coingecko_id),
  timeframe              text not null,   -- 1m
  ts                     timestamptz not null,   -- candle open time
  close_ts               timestamptz,
  open                   numeric,
  high                   numeric,
  low                    numeric,
  close                  numeric,
  volume                 numeric,          -- base asset
  quote_volume           numeric,          -- quote asset (≈ USD)
  trade_count            int,
  taker_buy_base_volume  numeric,
  taker_buy_quote_volume numeric,
  api_call_id            bigint references api_calls (id),
  primary key (venue, symbol, timeframe, ts)
);
create index cex_ohlcv_token_ts_idx on cex_ohlcv (coingecko_id, market_type, ts desc);

create table cex_ticker_snapshots (
  id             bigserial primary key,
  captured_at    timestamptz not null,
  api_call_id    bigint references api_calls (id),
  venue          text not null,
  market_type    text not null,
  symbol         text not null,
  coingecko_id   text references tokens (coingecko_id),
  exchange_ts    timestamptz,
  last           numeric,
  open           numeric,
  close          numeric,
  previous_close numeric,
  high           numeric,
  low            numeric,
  bid            numeric,
  bid_volume     numeric,
  ask            numeric,
  ask_volume     numeric,
  vwap           numeric,
  average        numeric,
  change         numeric,
  percentage     numeric,
  base_volume    numeric,
  quote_volume   numeric,
  mark_price     numeric,
  index_price    numeric,
  info           jsonb
);
create index cex_ticker_snapshots_token_time_idx on cex_ticker_snapshots (coingecko_id, captured_at desc);

create table funding_rate_snapshots (
  id                      bigserial primary key,
  captured_at             timestamptz not null,
  api_call_id             bigint references api_calls (id),
  venue                   text not null,
  symbol                  text not null,
  coingecko_id            text references tokens (coingecko_id),
  exchange_ts             timestamptz,
  mark_price              numeric,
  index_price             numeric,
  interest_rate           numeric,
  estimated_settle_price  numeric,
  funding_rate            numeric,
  funding_ts              timestamptz,
  next_funding_rate       numeric,
  next_funding_ts         timestamptz,
  previous_funding_rate   numeric,
  previous_funding_ts     timestamptz,
  interval                text,
  info                    jsonb
);
create index funding_rate_snapshots_token_time_idx on funding_rate_snapshots (coingecko_id, captured_at desc);

create table open_interest_snapshots (
  id                    bigserial primary key,
  captured_at           timestamptz not null,
  api_call_id           bigint references api_calls (id),
  venue                 text not null,
  symbol                text not null,
  coingecko_id          text references tokens (coingecko_id),
  exchange_ts           timestamptz not null,
  open_interest_amount  numeric,          -- contracts / base units
  open_interest_value   numeric,          -- quote (≈ USD)
  info                  jsonb,
  unique (venue, symbol, exchange_ts)
);
create index open_interest_snapshots_token_time_idx on open_interest_snapshots (coingecko_id, exchange_ts desc);

-- Binance futures positioning, 5-minute buckets: crowd and top-trader long/short, taker buy/sell volume.
create table futures_sentiment_snapshots (
  venue                         text not null,
  symbol                        text not null,
  coingecko_id                  text references tokens (coingecko_id),
  period                        text not null,   -- 5m
  ts                            timestamptz not null,
  global_long_short_ratio       numeric,
  global_long_account           numeric,
  global_short_account          numeric,
  top_account_long_short_ratio  numeric,
  top_account_long_account      numeric,
  top_account_short_account     numeric,
  top_position_long_short_ratio numeric,
  top_position_long_account     numeric,
  top_position_short_account    numeric,
  taker_buy_sell_ratio          numeric,
  taker_buy_volume              numeric,
  taker_sell_volume             numeric,
  info                          jsonb,           -- raw rows from each endpoint, keyed by endpoint
  updated_at                    timestamptz not null default now(),
  primary key (venue, symbol, period, ts)
);
create index futures_sentiment_token_ts_idx on futures_sentiment_snapshots (coingecko_id, ts desc);

-- ---------------------------------------------------------------------------
-- Investigation evidence (on demand)
-- ---------------------------------------------------------------------------

create table order_book_snapshots (
  id                  bigserial primary key,
  investigation_id    bigint,
  captured_at         timestamptz not null,
  api_call_id         bigint references api_calls (id),
  venue               text not null,
  symbol              text not null,
  coingecko_id        text references tokens (coingecko_id),
  exchange_ts         timestamptz,
  nonce               bigint,
  bids                jsonb not null,
  asks                jsonb not null,
  best_bid            numeric,
  best_ask            numeric,
  spread_pct          numeric,
  depth_bid_2pct_usd  numeric,
  depth_ask_2pct_usd  numeric
);

create table cex_trades (
  venue            text not null,
  symbol           text not null,
  trade_id         text not null,
  investigation_id bigint,
  coingecko_id     text references tokens (coingecko_id),
  ts               timestamptz not null,
  side             text,
  taker_or_maker   text,
  type             text,
  order_id         text,
  price            numeric,
  amount           numeric,
  cost             numeric,       -- price × amount (quote ≈ USD)
  fee              jsonb,
  info             jsonb,
  api_call_id      bigint references api_calls (id),
  primary key (venue, symbol, trade_id)
);
create index cex_trades_token_ts_idx on cex_trades (coingecko_id, ts desc);

-- Lock everything down like the CoinGecko tables (002): no Data API access.
alter table exchange_markets enable row level security;
alter table symbol_map enable row level security;
alter table cex_ohlcv enable row level security;
alter table cex_ticker_snapshots enable row level security;
alter table funding_rate_snapshots enable row level security;
alter table open_interest_snapshots enable row level security;
alter table futures_sentiment_snapshots enable row level security;
alter table order_book_snapshots enable row level security;
alter table cex_trades enable row level security;
