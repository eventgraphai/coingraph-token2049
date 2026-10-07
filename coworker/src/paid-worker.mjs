import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAnalystClient } from './analyst-client.mjs';
import { config, secrets } from './config.mjs';
import { createStore, safeId } from './worker-state.mjs';
import { runOnce, cliRuntime, WORKER_DIRECTORY } from './worker.mjs';
import { createPaymentPlan, createMpsClient } from './payment.ts';
import { createCoreRuntime, scopeCoreRuntime } from './core-runtime.mjs';
import { createCoreHttp } from './core-http.mjs';
import { httpRuntime } from './http-runtime.mjs';
import { createPaidAdapter, resumeReceipt } from './paid-adapter.mjs';

const POLL_DELAY_MS = 10_000;
export async function loadPaidConfiguration() {
  const cfg = config();
  const registration = cfg.registration;
  if (!registration || registration.status !== 'RegistrationConfirmed' || !Number.isInteger(registration.supportedPaymentSourceIndex)) {
    throw new Error('A confirmed Masumi registration is required in coworker/.local/config.json.');
  }
  createPaymentPlan({ taskId: 'configuration-check', name: 'Configuration check', description: null }, registration);
  const secret = secrets();
  return {
    coworkerId: safeId(cfg.coworkerId), userId: safeId(cfg.userId), source: registration, coingraphUrl: cfg.coingraphUrl,
    coworkerSecret: secret.COWORKER_SECRET,
    mps: createMpsClient({ baseUrl: cfg.mpsBaseUrl, token: secret.MPS_TOKEN }),
    blockfrostKey: secret.BLOCKFROST_API_KEY_PREPROD,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const receipt = args[0] === '--receipt';
  if (!(args.length === 0 || (args.length === 1 && ['--once', '--poll'].includes(args[0])) ||
        (receipt && args.length === 2))) throw new Error('Use --once, --poll, or --receipt TASK_ID.');
  const config = await loadPaidConfiguration();
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  // Hosted mode: the Coworker API key from the environment, Core over HTTP, no CLI or OS vault.
  const hosted = Boolean(process.env.SOKOSUMI_COWORKER_API_KEY);
  let core, runtime;
  if (hosted) {
    const client = createCoreHttp(process.env.SOKOSUMI_COWORKER_API_KEY);
    const me = (await client.get('/v1/coworkers/me'))?.data;
    if (me?.id !== config.coworkerId || me.archivedAt !== null || !me.capabilities?.includes('tasks')) throw new Error('Coworker key does not match the configured Coworker.');
    core = scopeCoreRuntime(client);
    runtime = httpRuntime(client, config.coworkerId);
  } else {
    core = await createCoreRuntime(config.coworkerId, config.userId);
    runtime = cliRuntime(config.coworkerId);
  }
  const store = await createStore(WORKER_DIRECTORY);
  if (hosted && process.env.COWORKER_SINGLE_REPLICA === 'true') await store.clearLock(config.coworkerId); // stale lock from a container restart
  const dependencies = {
    core, coworkerId: config.coworkerId, store, runtime,
    eve: createAnalystClient({ baseUrl: config.coingraphUrl, secret: config.coworkerSecret }),
    payments: createPaidAdapter({ ...config, core, signal: stop.signal }),
  };
  console.log(JSON.stringify({ status: 'started', mode: hosted ? 'hosted' : 'local', coworkerId: config.coworkerId }));
  if (receipt) {
    const release = await dependencies.store.lock(config.coworkerId);
    try { console.log(JSON.stringify(await resumeReceipt(safeId(args[1]), dependencies))); }
    finally { await release(); }
    return;
  }
  do {
    try { console.log(JSON.stringify(await runOnce(dependencies))); }
    catch (error) {
      // A stopped Task keeps its journal for inspection; keep serving other Tasks in poll mode.
      console.error(JSON.stringify({ status: 'error', message: String(error?.message ?? error).slice(0, 240) }));
      if (!args.includes('--poll')) throw error;
    }
    if (!args.includes('--poll')) break;
    await delay(POLL_DELAY_MS, undefined, { signal: stop.signal }).catch(() => {});
  } while (!stop.signal.aborted);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Paid worker stopped. Inspect the existing Task journal, registration, and runtime access before retrying.'); process.exitCode = 1; });
}
