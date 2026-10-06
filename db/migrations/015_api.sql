-- API objects: evaluations (the check), answers (ask), monitors + deliveries (alerts), payments + passes (x402).

create table evaluations (
  id             text primary key,                 -- eval_<random>
  coingecko_id   text not null references tokens (coingecko_id),
  verdict        text not null,                    -- proceed | caution | avoid
  confidence     numeric,
  dimensions     jsonb not null,
  reasons        jsonb not null,
  size_usd       numeric,
  policy         jsonb,
  size_check     jsonb,
  policy_check   jsonb,
  watch_next     jsonb,
  snapshot       jsonb,                            -- the numbers the verdict was computed from (what was known)
  sources        jsonb,
  hash           text not null,                    -- sha256 of the canonical data object
  requester      text,
  created_at     timestamptz not null default now()
);
create index evaluations_token_time_idx on evaluations (coingecko_id, created_at desc);

create table answers (
  id             text primary key,                 -- ans_<random>
  coingecko_id   text not null references tokens (coingecko_id),
  mode           text not null,                    -- question | claim
  input          text not null,
  answer         jsonb not null,
  evidence       jsonb,
  model          text,
  hash           text not null,
  created_at     timestamptz not null default now()
);
create index answers_token_time_idx on answers (coingecko_id, created_at desc);

create table monitors (
  id             text primary key,                 -- mon_<random>
  tokens         text[] not null,
  conditions     jsonb,
  webhook_url    text not null,
  secret         text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_delivered_at timestamptz
);

create table alert_deliveries (
  id             bigserial primary key,
  monitor_id     text not null references monitors (id),
  kind           text not null,                    -- signal | brief | verdict_change
  ref_id         text not null,
  coingecko_id   text,
  payload        jsonb not null,
  status         text not null default 'pending',  -- pending | delivered | failed
  attempts       int not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  unique (monitor_id, kind, ref_id)
);
create index alert_deliveries_pending_idx on alert_deliveries (status, created_at) where status = 'pending';

-- x402 payments (Cardano) and token passes.
create table payments (
  id             text primary key,                 -- pay_<random>
  endpoint       text not null,
  coingecko_id   text,
  amount_lovelace bigint not null,
  tx_hash        text unique,
  payer          text,
  network        text not null default 'preprod',
  status         text not null default 'verified', -- verified | consumed | rejected
  facilitator_response jsonb,
  created_at     timestamptz not null default now(),
  consumed_at    timestamptz
);

create table passes (
  id             text primary key,                 -- pass_<random> (bearer token)
  coingecko_id   text not null references tokens (coingecko_id),
  payment_id     text references payments (id),
  expires_at     timestamptz not null,
  calls          int not null default 0,
  created_at     timestamptz not null default now()
);
create index passes_token_idx on passes (coingecko_id, expires_at desc);

alter table evaluations enable row level security;
alter table answers enable row level security;
alter table monitors enable row level security;
alter table alert_deliveries enable row level security;
alter table payments enable row level security;
alter table passes enable row level security;
