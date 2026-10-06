import { env } from "../lib/env";
import { sql } from "../lib/db";
import * as cg from "../lib/coingecko/jobs";
import * as cx from "../lib/ccxt/jobs";
import * as extra from "../lib/extra/jobs";
import * as nn from "../lib/nownodes/jobs";
import { seedWalletLabels, verifySolanaWallets, verifyWalletLabels } from "../lib/nownodes/wallets";
import { runSignals } from "../lib/signals/engine";
import { runQueuedInvestigations } from "../lib/investigations/runner";
import * as ext from "../lib/external/jobs";
import { deliverAlerts } from "../lib/api/monitor";
import { syncSanctions, syncTokenSecurity } from "../lib/security/jobs";
import { runRetention } from "../lib/retention";
import { withDeadline } from "../lib/http";
import os from "node:os";
import { JOB_SCHEDULE, jobTimeoutMs as timeoutFor } from "../lib/jobs-meta";

// Long-running ingestion worker. Each job runs on its own interval, never overlaps itself,
// and a failure is logged without stopping the others. Every run is recorded in job_runs and the
// process reports a heartbeat, both shown on the /status dashboard.

const WORKER_ID = `${os.hostname()}:${process.pid}:${Date.now().toString(36)}`;
const WORKER_STARTED = new Date();

// Tracking writes are best-effort and bounded: they must never stall or fail a job.
async function track<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await withDeadline(query, 10_000, "tracking write");
  } catch (err) {
    console.warn(`[tracking] ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

type Job = {
  name: string;
  everySec: number;
  run: () => Promise<number | unknown>;
  endpoint?: string; // "provider|endpoint" in api_calls, used to resume the schedule after a restart
  offsetSec?: number; // run this many seconds into each slot
  running?: boolean;
  lastRun?: number;
};

const MARKETS_SLOW_SEC = 180;

// Contract map (from CoinGecko platform data) and the known-wallet list, re-verified against the chain.
async function syncOnchainReference(): Promise<number> {
  const contracts = await nn.syncOnchainContracts();
  await seedWalletLabels();
  for (const chain of ["eth", "bsc", "btc"] as const) await verifyWalletLabels(chain);
  await verifySolanaWallets();
  await nn.syncExchangeReserves(0); // all exchange wallets once a day; the hourly job covers the largest 25
  return contracts;
}

// Run functions for each scheduled job; timing and grouping live in lib/jobs-meta.ts.
const RUNNERS: Record<string, () => Promise<number | unknown>> = {
  "cg:markets": cg.syncMarkets,
  "cg:global": cg.syncGlobal,
  "cg:categories": cg.syncCategories,
  "cg:trending": cg.syncTrending,
  "cg:derivatives": cg.syncDerivatives,
  "cg:dex-pools": () => extra.syncDexPools(),
  "cg:exchange-tickers": () => extra.syncExchangeTickers(),
  "cg:public-treasuries": extra.syncPublicTreasuries,
  "cg:daily-reference": async () => {
    await cg.syncCoinsList();
    await cg.syncAssetPlatforms();
    await cg.syncOnchainNetworks();
    await extra.markDemoTokens();
    return cg.syncCoinDetails();
  },
  "ccxt:candles": cx.syncCandles,
  "ccxt:tickers": cx.syncTickers,
  "ccxt:demo-order-books": extra.syncDemoOrderBooks,
  "ccxt:symbol-map": cx.syncMarketsAndSymbolMap,
  "ccxt:funding": cx.syncFundingRates,
  "ccxt:open-interest": () => cx.syncOpenInterest(),
  "ccxt:okx-bybit-oi": () => extra.syncOkxBybitOpenInterest(),
  "ccxt:sentiment": () => cx.syncFuturesSentiment(),
  "ccxt:okx-bybit-long-short": () => extra.syncOkxBybitLongShort(),
  "okx:liquidations": extra.syncOkxLiquidations,
  "nn:eth-flows": () => nn.syncTokenFlows("eth"),
  "nn:bsc-flows": () => nn.syncTokenFlows("bsc"),
  "nn:fees": nn.syncChainFees,
  "nn:btc-blocks": () => nn.syncBtcBlocks(),
  "nn:btc-mempool": nn.syncBtcMempool,
  "nn:ada-transfers": nn.syncAdaLargeTransfers,
  "nn:exchange-reserves": async () => (await nn.syncExchangeReserves()) + (await nn.syncSolanaReserves()),
  "nn:node-status": nn.syncNodeStatus,
  "nn:holders": async () => (await nn.syncHolderConcentration()) + (await nn.syncCardanoAssets()),
  "nn:reference": syncOnchainReference,
  "news:rss": ext.syncNews,
  "fng:index": ext.syncFearGreed,
  "llama:tvl": ext.syncProtocolTvl,
  "security:tokens": syncTokenSecurity,
  "security:sanctions": syncSanctions,
  "signals:scan": runSignals,
  "investigations:run": () => runQueuedInvestigations(2),
  "alerts:deliver": deliverAlerts,
  "ccxt:backfill": () => cx.backfillCandles(7), // only fetches symbols missing history
  "cg:backfill": () => cg.backfillMarketCharts(30), // 30 days hourly; only fetches tokens missing history
  "cg:gap-fill": cg.fillMarketGaps,
  "ccxt:futures-repair": extra.repairFuturesGaps,
  "cg:credit-guard": creditGuard,
  "ccxt:exchange-status": extra.syncExchangeStatus,
  "maintenance:retention": runRetention,
};

const jobs: Job[] = JOB_SCHEDULE.map((m) => {
  const run = RUNNERS[m.name];
  if (!run) throw new Error(`No runner for scheduled job ${m.name}`);
  return { name: m.name, everySec: m.everySec, offsetSec: m.offsetSec, endpoint: m.endpoint, run };
});

// Credits needed per day at the configured intervals (daily jobs ≈ 105 calls).
function creditsPerDay(marketsEverySec: number): number {
  const perDay = (sec: number) => 86400 / sec;
  const { intervals: i } = env;
  const extraJobs = perDay(900) * env.demoTokens.length /* DEX pools */ + 100 /* exchange tickers */ + 6 /* treasuries */;
  return perDay(marketsEverySec) + perDay(i.global) + perDay(i.categories) + perDay(i.trending) + perDay(i.derivatives) + 105 + 120 + extraJobs;
}

// Slow /coins/markets to every 3 minutes if the account's remaining credits won't last the month.
async function creditGuard() {
  const usage = await cg.fetchKeyUsage();
  await track(sql`
    insert into system_metrics (db_size_bytes, credits_remaining, credits_monthly, connections, max_connections, table_sizes)
    select pg_database_size(current_database()), ${usage.current_remaining_monthly_calls}, ${usage.monthly_call_credit},
           (select count(*) from pg_stat_activity where datname = current_database()),
           current_setting('max_connections')::int,
           (select jsonb_object_agg(relname, size) from (
              select relname, pg_total_relation_size(relid) as size from pg_stat_user_tables order by 2 desc limit 8) t)`);
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

// A job that runs longer than this is abandoned (logged) so the next slot can start.
// Frequent jobs normally finish in < 60s; daily jobs (100+ calls) in a few minutes.
const jobTimeoutMs = (job: Job) => timeoutFor(job.everySec);
// If nothing completes for this long the process is wedged: exit so the supervisor restarts it.
const WATCHDOG_MS = 10 * 60_000;
let lastCompletion = Date.now();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); }),
  ]);
}

async function tick(job: Job) {
  if (job.running) return;
  job.running = true;
  const started = Date.now();
  const run = await track(sql<{ id: number }[]>`
    insert into job_runs (worker_id, job, started_at) values (${WORKER_ID}, ${job.name}, ${new Date(started)}) returning id`);
  const runId = run?.[0]?.id;
  try {
    const result = await withTimeout(Promise.resolve().then(job.run), jobTimeoutMs(job), job.name);
    const rowCount = typeof result === "number" && job.name !== "cg:credit-guard" ? result : null;
    console.log(`[${job.name}] ok ${rowCount !== null ? `${rowCount} rows ` : ""}(${Date.now() - started}ms)`);
    if (runId) await track(sql`update job_runs set status = 'ok', finished_at = now(), rows = ${rowCount}, duration_ms = ${Date.now() - started} where id = ${runId}`);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[${job.name}] failed: ${message}`);
    const status = message.includes("timed out after") ? "timeout" : "failed";
    if (runId) await track(sql`update job_runs set status = ${status}, finished_at = now(), duration_ms = ${Date.now() - started}, error = ${message.slice(0, 1000)} where id = ${runId}`);
    if (message.includes("timed out after")) {
      // A hung job almost always means dead database/network connections; they don't recover in-process.
      console.error("[watchdog] job timed out — exiting so the supervisor restarts the worker with fresh connections");
      process.exit(3);
    }
  } finally {
    job.lastRun = started;
    job.running = false;
    lastCompletion = Date.now();
  }
}

async function main() {
  console.log(`CoinGraph worker starting — universe=${env.universeSize}`);

  // Close records left open by processes that stopped mid-work (restart, crash, kill): they are
  // "interrupted" — neither success nor failure — so they don't skew success rates on /status.
  await track(sql`update job_runs set status = 'interrupted', finished_at = now(), error = 'worker stopped before the job finished'
                  where status = 'running' and worker_id <> ${WORKER_ID}`);
  await track(sql`update api_calls set finished_at = now(), error = 'interrupted: process stopped before the call finished'
                  where ok is null and finished_at is null and started_at < now() - interval '30 minutes'`);

  // Resume each job's schedule from its last successful call, so restarts don't re-run daily jobs.
  const last = await withTimeout(
    sql<{ key: string; at: Date }[]>`
      select provider || '|' || endpoint as key, max(started_at) as at from api_calls where ok group by provider, endpoint`,
    60_000,
    "startup schedule lookup",
  );
  const lastByEndpoint = new Map(last.map((r) => [r.key, r.at.getTime()]));
  for (const job of jobs) {
    if (job.endpoint && lastByEndpoint.has(job.endpoint)) job.lastRun = lastByEndpoint.get(job.endpoint);
  }

  // Start the scheduler immediately; nothing below may block it.
  // A job is due once per wall-clock slot (e.g. each minute for markets, :00/:05/:10 for categories),
  // so a late tick never shifts the schedule or skips a slot.
  const slot = (ms: number, job: Job) => Math.floor((ms - (job.offsetSec ?? 0) * 1000) / (job.everySec * 1000));
  setInterval(() => {
    const now = Date.now();
    for (const job of jobs) {
      if (!job.lastRun || slot(now, job) > slot(job.lastRun, job)) void tick(job);
    }
  }, 2_000);

  // Heartbeat every 30s: the dashboard flags the worker as down if beats stop.
  const beat = () =>
    track(sql`
      insert into worker_heartbeats (worker_id, hostname, pid, started_at, last_beat, jobs_running, meta)
      values (${WORKER_ID}, ${os.hostname()}, ${process.pid}, ${WORKER_STARTED}, now(),
              ${jobs.filter((j) => j.running).map((j) => j.name)}, ${sql.json({ node: process.version, rss_mb: Math.round(process.memoryUsage().rss / 1e6), pool: process.env.DB_POOL_MODE ?? "session" })})
      on conflict (worker_id) do update set last_beat = now(), jobs_running = excluded.jobs_running, meta = excluded.meta`);
  void beat();
  setInterval(() => void beat(), 30_000);

  setInterval(() => {
    if (Date.now() - lastCompletion > WATCHDOG_MS) {
      console.error(`[watchdog] no job completed in ${WATCHDOG_MS / 60_000} min — exiting so the supervisor restarts the worker`);
      process.exit(2);
    }
  }, 30_000);

  // One-off startup work runs alongside the scheduler, each step bounded.
  void (async () => {
    try {
      await withTimeout(extra.markDemoTokens(), 60_000, "mark demo tokens");
      const [{ mapped }] = await withTimeout(sql<{ mapped: number }[]>`select count(*)::int as mapped from symbol_map`, 60_000, "symbol map check");
      if (!mapped) await tick(jobs.find((j) => j.name === "ccxt:symbol-map")!);
      const [{ contracts }] = await withTimeout(sql<{ contracts: number }[]>`select count(*)::int as contracts from onchain_contracts`, 60_000, "contract map check");
      if (!contracts) await tick(jobs.find((j) => j.name === "nn:reference")!);
    } catch (err) {
      console.error(`[startup] ${(err as Error).message}`);
    }
    extra.startBinanceLiquidationStream();
  })();
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
