-- Chainlink CRE attestations: one row per proof id (eval_…, ans_…, run_… or a brief number), written by
-- the verify-investigation workflow after it independently recomputed the fingerprint and reached consensus.

create table attestations (
  id             text primary key,                 -- the proof id
  kind           text not null,                    -- evaluation | answer | agent_run:<agent> | brief
  sha256         text not null,                    -- the fingerprint the workflow computed
  attestation    jsonb not null,                   -- the full record served by /v1/verify/{id}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index attestations_created_idx on attestations (created_at desc);
alter table attestations enable row level security;
