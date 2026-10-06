import postgres from "postgres";
import { env } from "./env";

// Supabase transaction pooler (port 6543) does not support prepared statements.
export const sql = postgres(env.databaseUrl, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  onnotice: () => {},
});

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
