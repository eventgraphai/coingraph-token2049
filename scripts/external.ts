import { sql } from "../lib/db";
import * as ext from "../lib/external/jobs";

// `npm run external -- <news|fng|tvl>` — run one external-context feed by hand.
const commands: Record<string, () => Promise<unknown>> = { news: ext.syncNews, fng: ext.syncFearGreed, tvl: ext.syncProtocolTvl };

async function main() {
  const name = process.argv[2];
  const command = commands[name];
  if (!command) {
    console.error(`usage: npm run external -- <${Object.keys(commands).join("|")}>`);
    process.exit(1);
  }
  const started = Date.now();
  console.log(`${name}: ${await command()} (${Date.now() - started}ms)`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
