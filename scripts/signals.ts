import { sql } from "../lib/db";
import { runSignals } from "../lib/signals/engine";

// `npm run signals` — run the signal rules once and print what is open.
async function main() {
  const started = Date.now();
  const n = await runSignals();
  console.log(`signals: ${n} new (${Date.now() - started}ms)`);
  console.table(await sql`
    select coalesce(coingecko_id, 'market') as coin, kind, direction, severity, value, ratio, to_char(event_ts, 'HH24:MI') as at, investigation_id as inv
    from signals where detected_at > now() - interval '30 minutes' order by severity desc, detected_at desc limit 40`);
  console.table(await sql`select id, coingecko_id, status, score, to_char(opened_at, 'HH24:MI') as opened from investigations order by id desc limit 10`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
