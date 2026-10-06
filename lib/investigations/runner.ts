import { sql } from "../db";
import { gatherEvidence } from "./evidence";
import { writeBrief } from "./brief";

// Runs investigations: queued ones from the signal engine (worker job) and on-demand ones (API / CLI).
// Each investigation gathers evidence, has Claude write the brief, and stores everything on the row.

export const MAX_INVESTIGATIONS_PER_HOUR = Number(process.env.MAX_INVESTIGATIONS_PER_HOUR ?? 20);

export async function runInvestigation(id: number): Promise<void> {
  const [inv] = await sql`update investigations set status = 'running', started_at = now(), updated_at = now() where id = ${id} returning coingecko_id, window_from, window_to, trigger_signal_ids`;
  if (!inv) throw new Error(`investigation ${id} not found`);
  const started = Date.now();
  try {
    const evidence = await gatherEvidence(inv.coingecko_id, new Date(inv.window_from), new Date(inv.window_to), inv.trigger_signal_ids ?? []);
    const { brief, model, usage } = await writeBrief(evidence);
    await sql`
      update investigations set status = 'done', headline = ${brief.headline}, brief = ${sql.json(brief as never)}, evidence = ${sql.json(evidence as never)},
        model = ${model}, error = null, finished_at = now(), updated_at = now(),
        verification = coalesce(verification, '{}'::jsonb) || ${sql.json({ usage, duration_ms: Date.now() - started } as never)}
      where id = ${id}`;
    await sql`update signals set status = 'resolved' where investigation_id = ${id}`;
    console.log(`[investigate] #${id} ${inv.coingecko_id}: "${brief.headline}" (${evidence.items.length} evidence items, ${Date.now() - started}ms, ${usage.input}+${usage.output} tokens)`);
  } catch (err) {
    const message = (err as Error).message;
    await sql`update investigations set status = 'failed', error = ${message.slice(0, 1000)}, finished_at = now(), updated_at = now() where id = ${id}`;
    console.error(`[investigate] #${id} ${inv.coingecko_id} failed: ${message.slice(0, 200)}`);
    throw err;
  }
}

// Worker job: run up to `limit` queued investigations (oldest first), within the hourly cap.
export async function runQueuedInvestigations(limit = 2): Promise<number> {
  const [{ recent }] = await sql<{ recent: number }[]>`select count(*)::int as recent from investigations where started_at > now() - interval '1 hour'`;
  const room = Math.max(0, MAX_INVESTIGATIONS_PER_HOUR - recent);
  if (!room) return 0;
  const queued = await sql<{ id: number }[]>`select id from investigations where status = 'queued' order by opened_at limit ${Math.min(limit, room)}`;
  let done = 0;
  for (const { id } of queued) {
    try {
      await runInvestigation(id);
      done++;
    } catch {
      // recorded on the row
    }
  }
  return done;
}

// On demand (agent request or CLI): open and run an investigation for a coin over the last `hours`.
export async function investigateNow(coingecko_id: string, hours = 2, reason = "on-demand"): Promise<number> {
  const [inv] = await sql<{ id: number }[]>`
    insert into investigations (coingecko_id, status, score, window_from, window_to, trigger_signal_ids, error)
    values (${coingecko_id}, 'queued', null, now() - ${hours} * interval '1 hour', now(), '{}', null) returning id`;
  await sql`update investigations set verification = ${sql.json({ reason } as never)} where id = ${inv.id}`;
  await runInvestigation(inv.id);
  return inv.id;
}
