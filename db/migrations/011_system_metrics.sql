-- Hourly capacity snapshot (written by the credit-guard job): database size, CoinGecko credits,
-- connection use. Lets /status show growth per day and credit burn rate.
create table system_metrics (
  id                bigserial primary key,
  captured_at       timestamptz not null default now(),
  db_size_bytes     bigint,
  credits_remaining int,
  credits_monthly   int,
  connections       int,
  max_connections   int,
  table_sizes       jsonb          -- {table: bytes} for the largest tables
);
create index system_metrics_time_idx on system_metrics (captured_at desc);
alter table system_metrics enable row level security;
