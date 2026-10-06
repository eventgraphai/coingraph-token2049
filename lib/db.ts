import postgres from "postgres";
import { env } from "./env";

// DATABASE_URL points at Supabase's transaction pooler (6543). We connect through the session pooler
// (5432, same host and credentials) by default: under load the transaction pooler dropped connections
// mid-query, leaving queries hanging or returning another query's result. DB_POOL_MODE=transaction opts out.
const databaseUrl = process.env.DB_POOL_MODE === "transaction" ? env.databaseUrl : env.databaseUrl.replace(":6543/", ":5432/");
// Session mode holds one server connection per client connection, so keep each process small
// (worker 6, web app and scripts 4) to stay within the pooler's limits.
const maxConnections = Number(process.env.DB_MAX_CONNECTIONS ?? 6); // Supabase session pooler allows 15 clients: web 6 + worker 6 leaves room for scripts

const create = () =>
  postgres(databaseUrl, {
    prepare: false,
    max: maxConnections,
    idle_timeout: 10, // close idle connections quickly; long-idle pooler connections can die silently
    connect_timeout: 15, // seconds; a dropped pooler connection must fail fast, not hang
    max_lifetime: 60 * 5, // recycle connections every 5 min
    onnotice: () => {},
  });

// One client per process; Next.js dev reloads modules, so reuse it across reloads.
const globalForDb = globalThis as unknown as { coingraphSql?: ReturnType<typeof create> };
export const sql = globalForDb.coingraphSql ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.coingraphSql = sql;

// Insert rows in chunks so a single statement never exceeds Postgres' parameter limit.
export async function insertChunked<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  onConflict = "",
  chunkSize = 500,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const result = await sql`insert into ${sql(table)} ${sql(chunk as never)} ${sql.unsafe(onConflict)}`;
    written += result.count;
  }
  return written;
}
