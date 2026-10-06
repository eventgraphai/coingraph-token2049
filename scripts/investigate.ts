import { sql } from "../lib/db";
import { investigateNow, runInvestigation, runQueuedInvestigations } from "../lib/investigations/runner";

// `npm run investigate -- <coingecko_id> [hours]`  open + run an investigation now
// `npm run investigate -- queued`                   run queued investigations (what the worker does)
// `npm run investigate -- id <n>`                    re-run an existing investigation
async function main() {
  const [arg, extra] = process.argv.slice(2);
  if (!arg) {
    console.error("usage: npm run investigate -- <coingecko_id> [hours] | queued | id <n>");
    process.exit(1);
  }
  let id: number | null = null;
  if (arg === "queued") {
    console.log(`ran ${await runQueuedInvestigations(5)} queued investigations`);
  } else if (arg === "id") {
    id = Number(extra);
    await runInvestigation(id);
  } else {
    id = await investigateNow(arg, extra ? Number(extra) : 2, "cli");
  }
  if (id) {
    const [inv] = await sql`select id, coingecko_id, status, headline, model, error, brief, verification from investigations where id = ${id}`;
    console.log(JSON.stringify({ id: inv.id, coin: inv.coingecko_id, status: inv.status, headline: inv.headline, model: inv.model, error: inv.error, meta: inv.verification }, null, 2));
    if (inv.brief) console.log(JSON.stringify(inv.brief, null, 2));
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
