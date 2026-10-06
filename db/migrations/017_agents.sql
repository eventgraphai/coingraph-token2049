-- Agent runs: every run of a CoinGraph agent is stored with its exact output and hash, so it can be proven
-- (/v1/verify/run_…) and, for directional calls, graded in the public record.

create table agent_runs (
  id           text primary key,                 -- run_<random>
  agent        text not null,                    -- trade-gatekeeper, wallet-guard, …
  version      text not null,
  input        jsonb not null,
  output       jsonb not null,                   -- the exact object that was hashed
  verdict      text,
  tokens       text[] not null default '{}',     -- coingecko ids involved
  hash         text not null,
  duration_ms  int,
  requester    text,                             -- x402 payer / partner key id / anonymous
  payment      jsonb,                            -- x402 receipt when paid
  created_at   timestamptz not null default now()
);
create index agent_runs_agent_time_idx on agent_runs (agent, created_at desc);
create index agent_runs_tokens_idx on agent_runs using gin (tokens);

alter table agent_runs enable row level security;
