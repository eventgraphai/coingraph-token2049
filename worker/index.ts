import { env } from "../lib/env";
import { sql } from "../lib/db";
import * as cg from "../lib/coingecko/jobs";

// Long-running ingestion worker. Each job runs on its own interval, never overlaps itself,
// and a failure is logged without stopping the others.

type Job = {
  name: string;
  everySec: number;
  run: () => Promise<number | unknown>;
  endpoint?: string; // api_calls endpoint used to resume the schedule after a restart
  running?: boolean;
  lastRun?: number;
};

const MARKETS_SLOW_SEC = 180;

const jobs: Job[] = [
  { name: "cg:markets", everySec: env.intervals.markets, run: cg.syncMarkets, endpoint: "/coins/markets" },
  { name: "cg:global", everySec: env.intervals.global, run: cg.syncGlobal, endpoint: "/global" },
  { name: "cg:categories", everySec: env.intervals.categories, run: cg.syncCategories, endpoint: "/coins/categories" },
  { name: "cg:trending", everySec: env.intervals.trending, run: cg.syncTrending, endpoint: "/search/trending" },
  { name: "cg:derivatives", everySec: env.intervals.derivatives, run: cg.syncDerivatives, endpoint: "/derivatives" },
  {
    name: "cg:daily-reference",
    everySec: env.intervals.daily,
    endpoint: "/coins/{id}",
    run: async () => {
      await cg.syncCoinsList();
      await cg.syncAssetPlatforms();
      await cg.syncOnchainNetworks();
      return cg.syncCoinDetails();
    },
  },
  { name: "cg:backfill", everySec: 3600, run: () => cg.backfillMarketCharts(7) }, // only fetches tokens missing history
  { name: "cg:credit-guard", everySec: env.intervals.keyUsage, run: creditGuard, endpoint: "/key" },
];

// Credits needed per day at the configured intervals (daily jobs ≈ 105 calls).
function creditsPerDay(marketsEverySec: number): number {
  const perDay = (sec: number) => 86400 / sec;
  const { intervals: i } = env;
  return perDay(marketsEverySec) + perDay(i.global) + perDay(i.categories) + perDay(i.trending) + perDay(i.derivatives) + 105 + 120;
}

// Slow /coins/markets to every 3 minutes if the account's remaining credits won't last the month.
async function creditGuard() {
  const usage = await cg.fetchKeyUsage();
  const now = new Date();
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const daysLeft = Math.max((monthEnd - now.getTime()) / 86_400_000, 0.1);
  const needed = creditsPerDay(env.intervals.markets) * daysLeft;
  const markets = jobs.find((j) => j.name === "cg:markets")!;
  const slow = usage.current_remaining_monthly_calls < needed * 1.1;
  markets.everySec = slow ? Math.max(MARKETS_SLOW_SEC, env.intervals.markets) : env.intervals.markets;
  console.log(
    `[credit-guard] remaining=${usage.current_remaining_monthly_calls} needed≈${Math.round(needed)} → markets every ${markets.everySec}s`,
  );
  return usage.current_remaining_monthly_calls;
}

async function tick(job: Job) {
  if (job.running) return;
  job.running = true;
  const started = Date.now();
  try {
    const result = await job.run();
    const rows = typeof result === "number" && job.name !== "cg:credit-guard" ? `${result} rows ` : "";
    console.log(`[${job.name}] ok ${rows}(${Date.now() - started}ms)`);
  } catch (err) {
    console.error(`[${job.name}] failed: ${(err as Error).message}`);
  } finally {
    job.lastRun = started;
    job.running = false;
  }
}

async function main() {
  console.log(`CoinGraph worker starting — universe=${env.universeSize}`);

  // Resume each job's schedule from its last successful call, so restarts don't re-run daily jobs.
  const last = await sql<{ endpoint: string; at: Date }[]>`
    select endpoint, max(started_at) as at from api_calls where provider = 'coingecko' and ok group by endpoint`;
  const lastByEndpoint = new Map(last.map((r) => [r.endpoint, r.at.getTime()]));
  for (const job of jobs) {
    if (job.endpoint && lastByEndpoint.has(job.endpoint)) job.lastRun = lastByEndpoint.get(job.endpoint);
  }

  // Markets first so the universe exists before anything references it.
  await tick(jobs.find((j) => j.name === "cg:markets")!);

  // Check every few seconds which jobs are due; aligns cleanly with minute boundaries.
  setInterval(() => {
    const now = Date.now();
    for (const job of jobs) {
      if (!job.lastRun || now - job.lastRun >= job.everySec * 1000) void tick(job);
    }
  }, 5_000);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
