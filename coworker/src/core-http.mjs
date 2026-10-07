// Minimal Sokosumi Core client for a hosted worker: the Coworker API key (SOKOSUMI_COWORKER_API_KEY) as a Bearer
// token, no OS vault and no user login. Same request rules as the CLI's coworker client: /v1/ paths, no redirects.
const API = (process.env.SOKOSUMI_API_URL || 'https://api.preprod.sokosumi.com').replace(/\/+$/, '');

export function createCoreHttp(apiKey) {
  if (typeof apiKey !== 'string' || !/^coworker_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('SOKOSUMI_COWORKER_API_KEY is missing or invalid.');
  async function request(method, path, body, signal) {
    if (!path.startsWith('/v1/') || /[\s\\#]|\.\./.test(path)) throw new Error('Core requests require a /v1/ path.');
    const res = await fetch(`${API}${path}`, {
      method, redirect: 'error',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const error = new Error(`Core ${method} ${path.split('?')[0]} returned ${res.status}`);
      error.status = res.status; error.body = json;
      throw error;
    }
    return json;
  }
  return { get: (path, signal) => request('GET', path, undefined, signal), post: (path, body, signal) => request('POST', path, body, signal) };
}
