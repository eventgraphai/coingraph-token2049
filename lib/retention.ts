import { sql } from "./db";
import { env } from "./env";
import { storage } from "./archive";

// Daily cleanup that keeps storage bounded:
// - High-frequency snapshot tables: full detail for RETENTION_MINUTE_DAYS, then the first row
//   per series per hour is kept forever. Rows inside a retention_holds window are never thinned.
// - Raw archive objects older than RAW_ARCHIVE_DAYS are deleted from storage.
// api_calls is kept: retained hourly rows reference it for provenance, and it is small.

type Series = { table: string; partition: string; seriesColumn?: string; timeColumn?: string };

const SERIES: Series[] = [
  { table: "market_snapshots", partition: "coingecko_id", seriesColumn: "coingecko_id" },
  { table: "category_snapshots", partition: "category_id" },
  { table: "derivatives_tickers", partition: "coingecko_id, market, symbol", seriesColumn: "coingecko_id" },
  { table: "cex_ohlcv", partition: "venue, symbol, timeframe", seriesColumn: "coingecko_id", timeColumn: "ts" },
  { table: "cex_ticker_snapshots", partition: "venue, symbol", seriesColumn: "coingecko_id" },
  { table: "funding_rate_snapshots", partition: "venue, symbol", seriesColumn: "coingecko_id" },
  { table: "open_interest_snapshots", partition: "venue, symbol", seriesColumn: "coingecko_id", timeColumn: "exchange_ts" },
  { table: "futures_sentiment_snapshots", partition: "venue, symbol, period", seriesColumn: "coingecko_id", timeColumn: "ts" },
  { table: "dex_pool_snapshots", partition: "network, pool_address", seriesColumn: "coingecko_id" },
  { table: "order_book_snapshots", partition: "venue, symbol", seriesColumn: "coingecko_id" },
  { table: "exchange_status", partition: "venue" },
  { table: "nownodes_node_status", partition: "interface" },
];

async function thinTable({ table, partition, seriesColumn, timeColumn = "captured_at" }: Series, cutoff: Date): Promise<number> {
  const [{ min }] = await sql<{ min: Date | null }[]>`select min(${sql(timeColumn)}) as min from ${sql(table)}`;
  if (!min || min >= cutoff) return 0;

  // Holds apply per coin where the table has one; category rows are held by coin-agnostic holds only.
  const holdMatch = seriesColumn
    ? `(h.coingecko_id is null or h.coingecko_id = t.${seriesColumn})`
    : `h.coingecko_id is null`;

  let deleted = 0;
  // One day per statement keeps each delete small and lock time short.
  for (let dayStart = new Date(min); dayStart < cutoff; dayStart = new Date(dayStart.getTime() + 86_400_000)) {
    const dayEnd = new Date(Math.min(dayStart.getTime() + 86_400_000, cutoff.getTime()));
    // ctid addresses rows in tables with and without a surrogate id (e.g. cex_ohlcv's composite key).
    const result = await sql.unsafe(
      `delete from ${table} t
       using (
         select ctid from (
           select ctid, row_number() over (partition by ${partition}, date_trunc('hour', ${timeColumn}) order by ${timeColumn}) as rn
           from ${table} where ${timeColumn} >= $1 and ${timeColumn} < $2
         ) ranked where rn > 1
       ) extra
       where t.ctid = extra.ctid
         and not exists (
           select 1 from retention_holds h
           where ${holdMatch} and t.${timeColumn} between h.from_ts and h.to_ts
         )`,
      [dayStart, dayEnd],
    );
    deleted += result.count;
  }
  return deleted;
}

async function purgeRawArchive(cutoff: Date): Promise<number> {
  const bucket = storage();
  if (!bucket) return 0;

  let removed = 0;
  for (;;) {
    const rows = await sql<{ id: number; raw_path: string }[]>`
      select id, raw_path from api_calls
      where raw_path is not null and started_at < ${cutoff}
      order by id limit 500`;
    if (!rows.length) break;

    const { error } = await bucket.from(env.rawArchiveBucket).remove(rows.map((r) => r.raw_path));
    if (error) throw error;
    await sql`update api_calls set raw_path = null where id = any(${rows.map((r) => r.id)})`;
    removed += rows.length;
  }
  return removed;
}

export async function runRetention(): Promise<number> {
  const minuteCutoff = new Date(Date.now() - env.retention.minuteDays * 86_400_000);
  const rawCutoff = new Date(Date.now() - env.retention.rawArchiveDays * 86_400_000);

  let total = 0;
  for (const series of SERIES) {
    const n = await thinTable(series, minuteCutoff);
    if (n) console.log(`[retention] ${series.table}: thinned ${n} rows older than ${minuteCutoff.toISOString()}`);
    total += n;
  }
  // Close API calls whose process stopped mid-call (> 30 min without finishing).
  await sql`update api_calls set finished_at = now(), error = 'interrupted: process stopped before the call finished'
            where ok is null and finished_at is null and started_at < now() - interval '30 minutes'`;

  // Operational tracking: 14 days of job runs, heartbeats of exited worker processes for 2 days.
  const runs = await sql`delete from job_runs where started_at < now() - interval '14 days'`;
  const beats = await sql`delete from worker_heartbeats where last_beat < now() - interval '2 days'`;
  total += runs.count + beats.count;

  const raw = await purgeRawArchive(rawCutoff);
  if (raw) console.log(`[retention] raw archive: removed ${raw} objects older than ${rawCutoff.toISOString()}`);
  return total + raw;
}
