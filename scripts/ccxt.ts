import { sql } from "../lib/db";
import * as cx from "../lib/ccxt/jobs";
import * as extra from "../lib/extra/jobs";

// Run one CCXT job by hand: `npm run ccxt -- symbols`, `npm run ccxt -- backfill-candles 7`, `npm run ccxt -- book aave`.
const commands: Record<string, (args: string[]) => Promise<unknown>> = {
  symbols: () => cx.syncMarketsAndSymbolMap(),
  candles: () => cx.syncCandles(),
  tickers: () => cx.syncTickers(),
  funding: () => cx.syncFundingRates(),
  oi: () => cx.syncOpenInterest(),
  sentiment: () => cx.syncFuturesSentiment(),
  "backfill-candles": (args) => cx.backfillCandles(Number(args[0] ?? 7)),
  "backfill-futures": (args) => cx.backfillFutures(Number(args[0] ?? 2)),
  book: (args) => cx.captureOrderBooks(args[0]),
  trades: (args) => cx.captureRecentTrades(args[0]),
  "demo-flags": () => extra.markDemoTokens(),
  liquidations: () => extra.syncOkxLiquidations(),
  "okx-bybit-oi": () => extra.syncOkxBybitOpenInterest(),
  "okx-bybit-long-short": () => extra.syncOkxBybitLongShort(),
  "backfill-okx-bybit": (args) => extra.backfillOkxBybit(Number(args[0] ?? 2)),
  "demo-books": () => extra.syncDemoOrderBooks(),
  status: () => extra.syncExchangeStatus(),
  "dex-pools": (args) => extra.syncDexPools(args.length ? args : undefined),
  "exchange-tickers": (args) => extra.syncExchangeTickers(args.length ? args : undefined),
  treasuries: () => extra.syncPublicTreasuries(),
  "futures-repair": () => extra.repairFuturesGaps(),
};

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const command = commands[name];
  if (!command) {
    console.log(`usage: npm run ccxt -- <${Object.keys(commands).join("|")}> [args]`);
    process.exit(1);
  }
  const started = Date.now();
  const result = await command(args);
  console.log(`${name}: ${result} (${Date.now() - started}ms)`);
  await new Promise((r) => setTimeout(r, 3000)); // let background raw-archive uploads finish
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
