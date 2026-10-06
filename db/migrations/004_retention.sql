-- Time windows the retention job must never thin (e.g. the minutes an investigation relied on).
-- coingecko_id null = hold applies to every coin in the window.

create table retention_holds (
  id           bigserial primary key,
  coingecko_id text,
  from_ts      timestamptz not null,
  to_ts        timestamptz not null,
  reason       text not null,           -- e.g. 'investigation:123', 'demo-case'
  created_at   timestamptz not null default now(),
  check (to_ts >= from_ts)
);
create index retention_holds_window_idx on retention_holds (from_ts, to_ts);

alter table retention_holds enable row level security;
