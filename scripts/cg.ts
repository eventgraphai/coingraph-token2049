import { sql } from "../lib/db";
import * as cg from "../lib/coingecko/jobs";

// Run one CoinGecko job by hand: `npm run cg -- markets`, `npm run cg -- backfill 7`, `npm run cg -- details aave`.
const commands: Record<string, (args: string[]) => Promise<unknown>> = {
  markets: () => cg.syncMarkets(),
  global: () => cg.syncGlobal(),
  categories: () => cg.syncCategories(),
  trending: () => cg.syncTrending(),
  derivatives: () => cg.syncDerivatives(),
  "coins-list": () => cg.syncCoinsList(),
  platforms: () => cg.syncAssetPlatforms(),
  networks: () => cg.syncOnchainNetworks(),
  details: (args) => cg.syncCoinDetails(args.length ? args : undefined),
  backfill: (args) => cg.backfillMarketCharts(Number(args[0] ?? 7)),
  key: () => cg.fetchKeyUsage(),
};

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const command = commands[name];
  if (!command) {
    console.log(`usage: npm run cg -- <${Object.keys(commands).join("|")}> [args]`);
    process.exit(1);
  }
  const started = Date.now();
  const result = await command(args);
  console.log(`${name}: ${typeof result === "object" ? JSON.stringify(result) : result} (${Date.now() - started}ms)`);
  // Give background raw-archive uploads a moment to finish.
  await new Promise((r) => setTimeout(r, 3000));
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
