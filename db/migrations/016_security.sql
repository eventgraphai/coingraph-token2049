-- Contract security (GoPlus) and sanctions lists (OFAC via 0xB10C) — fills the "contract: unassessed" gap.

create table token_security_snapshots (
  coingecko_id     text not null references tokens (coingecko_id),
  chain            text not null,                -- eth | bsc | sol
  address          text not null,
  captured_at      timestamptz not null,
  provider         text not null default 'goplus',
  risk_level       text not null,                -- low | medium | high
  risk_flags       text[] not null default '{}', -- plain-language flags, worst first
  is_honeypot      boolean,
  cannot_sell_all  boolean,
  buy_tax_pct      numeric,
  sell_tax_pct     numeric,
  is_mintable      boolean,
  is_proxy         boolean,                      -- upgradeable contract
  owner_change_balance boolean,
  hidden_owner     boolean,
  can_take_back_ownership boolean,
  has_blacklist    boolean,
  transfer_pausable boolean,
  selfdestruct     boolean,
  is_open_source   boolean,
  freezable        boolean,                      -- Solana freeze authority
  metadata_mutable boolean,                      -- Solana
  trusted_token    boolean,
  holder_count     bigint,
  top10_holders_pct numeric,                     -- excluding burn and locked addresses
  owner_address    text,
  creator_address  text,
  raw              jsonb not null,
  api_call_id      bigint references api_calls (id),
  primary key (coingecko_id, chain, captured_at)
);
create index token_security_latest_idx on token_security_snapshots (coingecko_id, captured_at desc);

create table sanctioned_addresses (
  chain        text not null,                    -- btc | eth | bsc | sol | trx | usdt | usdc | …
  address      text not null,                    -- lowercase for EVM
  source       text not null default 'ofac-sdn (0xB10C list)',
  updated_at   timestamptz not null default now(),
  primary key (chain, address)
);

alter table token_security_snapshots enable row level security;
alter table sanctioned_addresses enable row level security;
