import { sql } from "../lib/db";

// `npm run health` — prints the ingestion_health view plus data freshness. Exits 1 if any feed is down.
async function main() {
  const feeds = await sql`
    select feed, status, age_sec, calls_1h, failures_1h, rows_1h, avg_latency_ms_1h, archived_1h
    from ingestion_health`;
  console.table(feeds);

  const [fresh] = await sql`
    select to_char(max(captured_at), 'YYYY-MM-DD HH24:MI') as latest_minute,
           count(distinct coingecko_id) filter (where captured_at = (select max(captured_at) from market_snapshots)) as coins_latest,
           count(distinct captured_at) filter (where captured_at > now() - interval '60 minutes') as minutes_covered_last_60
    from market_snapshots`;
  console.log("market_snapshots:", fresh);

  await sql.end();
  if (feeds.some((f) => f.status === "down")) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
