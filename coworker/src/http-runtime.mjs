import { readFile } from 'node:fs/promises';
import { safeId } from './worker-state.mjs';

// Hosted replacement for the CLI runtime (list, inspect, start, complete) using only the Coworker API key.
// New Tasks are discovered from the Coworker's event feed (/v1/coworkers/me/events): every Task that has a READY
// event is read back and kept only if it is still READY and assigned to this Coworker.

const normal = t => ({ id: t.id, name: t.name, description: t.description, status: t.status,
  organizationId: t.organizationId ?? null, assigneeId: t.assigneeId ?? t.coworkerId });

export function httpRuntime(client, coworkerId) {
  async function task(id) {
    const t = (await client.get(`/v1/tasks/${safeId(id)}`))?.data;
    if (!t || t.id !== id) throw new Error('Task read did not match.');
    return t;
  }
  async function events(taskId) {
    const all = []; let cursor; let pages = 0;
    do {
      const q = new URLSearchParams({ limit: '100' }); if (cursor) q.set('cursor', cursor);
      const page = await client.get(`/v1/tasks/${safeId(taskId)}/events?${q}`);
      if (!Array.isArray(page?.data)) throw new Error('Invalid event page.');
      all.push(...page.data);
      cursor = page.meta?.pagination?.nextCursor ?? null;
    } while (cursor && ++pages < 20);
    return all;
  }
  return {
    async list() {
      const ready = new Set(); let cursor; let pages = 0;
      do {
        const q = new URLSearchParams({ limit: '100' }); if (cursor) q.set('cursor', cursor);
        const page = await client.get(`/v1/coworkers/me/events?${q}`);
        for (const e of page?.data ?? []) if (e.status === 'READY' && typeof e.taskId === 'string') ready.add(e.taskId);
        cursor = page?.meta?.pagination?.nextCursor ?? null;
      } while (cursor && ++pages < 50);
      const out = [];
      for (const id of ready) {
        try {
          const t = await task(id);
          if (t.status === 'READY' && (t.assigneeId ?? t.coworkerId) === coworkerId) out.push(normal(t));
        } catch { /* skip unreadable Tasks; they are retried on the next pass */ }
      }
      return out;
    },
    async inspect(id) {
      return { task: normal(await task(id)), events: await events(id) };
    },
    async start(id) {
      const t = await task(id);
      if (t.status !== 'READY') throw new Error('Task is not READY. No start was submitted.');
      const ev = (await client.post(`/v1/tasks/${safeId(id)}/events`, { status: 'RUNNING' }))?.data;
      if (!ev?.id || ev.taskId !== id || ev.status !== 'RUNNING') throw new Error('Task start could not be confirmed. Inspect the Task before retrying.');
      return { ...normal(t), status: 'RUNNING' };
    },
    async complete(id, path) {
      const text = await readFile(path, 'utf8');
      const t = await task(id);
      if (t.status !== 'RUNNING') throw new Error('Task is not RUNNING. No completion was submitted.');
      const ev = (await client.post(`/v1/tasks/${safeId(id)}/events`, { status: 'COMPLETED', comment: text }))?.data;
      return { status: ev?.status, taskId: ev?.taskId, eventId: ev?.id };
    },
  };
}
