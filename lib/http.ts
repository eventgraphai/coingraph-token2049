import { sql } from "./db";
import { archiveRaw } from "./archive";

export type LoggedResponse<T> = { data: T; apiCallId: number };

type Options = {
  provider: string;
  endpoint: string; // logical endpoint, e.g. "/coins/markets"
  url: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
};

// Every external API call goes through here: it is logged in api_calls (provenance),
// retried on 429/5xx, and its raw body is archived to storage in the background.
export async function fetchLogged<T>(opts: Options): Promise<LoggedResponse<T>> {
  const { provider, endpoint, url, params, headers, retries = 3, timeoutMs = 60_000 } = opts;

  const [{ id }] = await sql<{ id: number }[]>`
    insert into api_calls (provider, endpoint, params)
    values (${provider}, ${endpoint}, ${params ? sql.json(params as never) : null})
    returning id`;

  const started = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        await sleep(Math.min(2 ** attempt * 2000, 30_000));
        continue;
      }

      await sql`
        update api_calls set
          status_code = ${res.status}, ok = ${res.ok}, finished_at = now(),
          latency_ms = ${Date.now() - started}, response_bytes = ${body.length},
          error = ${res.ok ? null : body.slice(0, 1000)}
        where id = ${id}`;

      if (!res.ok) throw new Error(`${provider} ${endpoint} HTTP ${res.status}: ${body.slice(0, 200)}`);

      archiveRaw(id, provider, endpoint, body);
      return { data: JSON.parse(body) as T, apiCallId: id };
    } catch (err) {
      lastError = err as Error;
      if (lastError.message.includes(" HTTP 4")) break; // client errors are not retryable
      if (attempt < retries) await sleep(Math.min(2 ** attempt * 2000, 30_000));
    }
  }

  await sql`
    update api_calls set ok = false, finished_at = now(), latency_ms = ${Date.now() - started},
      error = ${lastError?.message.slice(0, 1000) ?? "unknown error"}
    where id = ${id} and finished_at is null`;
  throw lastError ?? new Error(`${provider} ${endpoint} failed`);
}

// Hard deadline for any promise. SDK timeouts (e.g. CCXT's) don't always fire on a stalled socket,
// and one stalled exchange must not block every job behind it.
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: no response after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

// Same provenance for calls made through SDKs (e.g. CCXT) rather than fetch: one api_calls row per
// logical call or batch, the JSON-serialized result archived as the raw response.
export async function withApiLog<T>(
  provider: string,
  endpoint: string,
  params: Record<string, unknown> | null,
  fn: () => Promise<T>,
  deadlineMs = 150_000,
): Promise<LoggedResponse<T>> {
  const [{ id }] = await sql<{ id: number }[]>`
    insert into api_calls (provider, endpoint, params)
    values (${provider}, ${endpoint}, ${params ? sql.json(params as never) : null})
    returning id`;
  const started = Date.now();
  try {
    const data = await withDeadline(fn(), deadlineMs, `${provider} ${endpoint}`);
    const body = JSON.stringify(data);
    await sql`
      update api_calls set status_code = 200, ok = true, finished_at = now(),
        latency_ms = ${Date.now() - started}, response_bytes = ${body.length}
      where id = ${id}`;
    archiveRaw(id, provider, endpoint, body);
    return { data, apiCallId: id };
  } catch (err) {
    await sql`
      update api_calls set ok = false, finished_at = now(), latency_ms = ${Date.now() - started},
        error = ${(err as Error).message.slice(0, 1000)}
      where id = ${id}`;
    throw err;
  }
}

export async function recordRowCount(apiCallId: number, rowCount: number): Promise<void> {
  await sql`update api_calls set row_count = ${rowCount} where id = ${apiCallId}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
