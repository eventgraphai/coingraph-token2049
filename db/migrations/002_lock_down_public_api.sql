-- CoinGraph data is written and read only by our own server (direct Postgres connection as owner).
-- Nothing should be reachable through Supabase's Data API with the public anon/publishable key.
-- 1) Enable RLS with no policies (deny-all for API roles) on every table.
-- 2) Revoke all privileges from anon/authenticated, now and for tables created later.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
