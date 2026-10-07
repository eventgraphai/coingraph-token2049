import { randomUUID } from 'node:crypto';

// Stands in for the eve client the Masumi template expects (health, sessions.create, session.send, result).
// Each "session" is one call to CoinGraph's private analyst endpoint, which routes the Task to CoinGraph's agents.
export function createAnalystClient({ baseUrl, secret, timeoutMs = 280_000 }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('CoinGraph URL must be HTTPS.');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('COWORKER_SECRET is missing.');
  return {
    async health() {
      const res = await fetch(new URL('/api/v1/status', base), { signal: AbortSignal.timeout(30_000), redirect: 'error' });
      if (!res.ok) throw new Error('CoinGraph is not reachable.');
    },
    sessions: {
      async create() {
        const sessionId = `cg_${randomUUID().replace(/-/g, '')}`;
        return {
          session: {
            state: { sessionId },
            async send(input) {
              let ok = false, body = null;
              try {
                const res = await fetch(new URL('/api/internal/coworker/analyze', base), {
                  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
                  headers: { 'content-type': 'application/json', 'x-coworker-secret': secret },
                  body: JSON.stringify({ request: input, requester: `sokosumi:${sessionId}` }),
                });
                ok = res.ok; body = await res.json().catch(() => null);
              } catch { ok = false; }
              return {
                async result() {
                  const text = body?.data?.text;
                  if (!ok || typeof text !== 'string' || !text.trim()) return { status: 'failed', message: '', inputRequests: [], events: [{ type: 'turn.failed' }] };
                  return { status: 'completed', message: text, inputRequests: [], events: [] };
                },
              };
            },
          },
        };
      },
    },
  };
}
