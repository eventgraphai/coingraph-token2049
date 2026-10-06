-- Signal engine: rules over the stored market, exchange and onchain data flag unusual activity per coin;
-- when a coin's recent signals add up, an investigation is queued (run by the investigation worker).

create table signals (
  id               bigserial primary key,
  coingecko_id     text references tokens (coingecko_id),   -- null = market-wide signal
  kind             text not null,          -- price_move | volume_spike | oi_change | funding_extreme | liquidation_cluster |
                                           -- exchange_inflow | exchange_outflow | whale_transfer | stablecoin_exchange_inflow | positioning_extreme
  direction        text not null,          -- up | down | neutral (expected price pressure)
  severity         int not null,           -- 1 low, 2 medium, 3 high
  value            numeric,                -- the observed number (return %, USD, ratio …)
  baseline         numeric,                -- what is normal for this coin
  ratio            numeric,                -- value vs baseline (z-score or multiple)
  window_sec       int,
  event_ts         timestamptz not null,   -- when the activity happened
  bucket           timestamptz not null,   -- 15-minute bucket of event_ts: one signal per coin, kind and bucket
  detected_at      timestamptz not null default now(),
  details          jsonb,
  investigation_id bigint,
  status           text not null default 'open'
);
create unique index signals_dedupe_idx on signals (coalesce(coingecko_id, 'market'), kind, bucket);
create index signals_coin_time_idx on signals (coingecko_id, event_ts desc);
create index signals_time_idx on signals (detected_at desc);

create table investigations (
  id                 bigserial primary key,
  coingecko_id       text not null references tokens (coingecko_id),
  opened_at          timestamptz not null default now(),
  status             text not null default 'queued',  -- queued | running | done | failed
  score              numeric,
  window_from        timestamptz not null,
  window_to          timestamptz not null,
  trigger_signal_ids bigint[] not null default '{}',
  headline           text,
  brief              jsonb,                 -- structured brief (claims with sources)
  evidence           jsonb,                 -- gathered numbers and onchain evidence
  model              text,
  verification       jsonb,                 -- Chainlink CRE receipt (hash, tx) once verified
  error              text,
  started_at         timestamptz,
  finished_at        timestamptz,
  updated_at         timestamptz not null default now()
);
create index investigations_coin_time_idx on investigations (coingecko_id, opened_at desc);
create index investigations_status_idx on investigations (status, opened_at desc);

alter table signals enable row level security;
alter table investigations enable row level security;
