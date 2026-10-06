import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { CORS } from "@/lib/api/respond";

// Remote MCP endpoint (Streamable HTTP, stateless): https://token2049.coingraph.ai/mcp
// Each request gets a fresh server + transport; no session state is kept between calls.

const MCP_CORS = { ...CORS, "access-control-allow-headers": `${CORS["access-control-allow-headers"]}, mcp-session-id, mcp-protocol-version, last-event-id`, "access-control-expose-headers": "mcp-session-id, mcp-protocol-version" };

async function handle(req: Request): Promise<Response> {
  const server = buildMcpServer(req.headers.get("x-forwarded-for"));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 64 * 1024 });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(MCP_CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } finally {
    // Stateless: close once the JSON response has been produced.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

// A browser opening the URL gets a short page on how to connect; MCP clients (which ask for
// text/event-stream or JSON) get the protocol as before.
function connectPage(origin: string): Response {
  const url = `${origin}/mcp`;
  const tools: [string, string][] = [
    ["search_tokens", "Find a token, or list the 100 tracked"],
    ["get_token_snapshot", "Everything known about a token right now"],
    ["get_token_timeline", "Charts and events over time"],
    ["check_token", "The check before acting: proceed / caution / avoid"],
    ["get_token_brief", "Why it moved, every claim cited"],
    ["ask_about_token", "Ask a question or test a claim"],
    ["watch_tokens", "Webhook alerts when something changes"],
    ["get_market_overview", "The whole market at a glance"],
    ["lookup_address", "Who is behind an address"],
    ["get_track_record", "Every call we made, and whether it was right"],
    ["get_proof", "Proof of exactly what you were told"],
    ["get_service_status", "Health and data freshness"],
  ];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoinGraph MCP server</title><style>
:root{--bg:#0b0d10;--card:#13161b;--edge:#232831;--ink:#e8ebef;--mist:#8b93a1;--brand:#3ddc84}
@media (prefers-color-scheme:light){:root{--bg:#f7f8fa;--card:#fff;--edge:#e3e6eb;--ink:#14171c;--mist:#5b6472;--brand:#11924e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px 64px}h1{font-size:28px;margin:6px 0 8px;letter-spacing:-.02em}
.k{font:600 11px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--brand)}p{color:var(--mist);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--edge);border-radius:12px;padding:16px;margin:0 0 14px}
code,pre{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}pre{margin:8px 0 0;padding:12px;background:var(--bg);border:1px solid var(--edge);border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
h2{font-size:14px;margin:0 0 4px}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-top:1px solid var(--edge);vertical-align:top}td:first-child{padding-right:14px;white-space:nowrap}
a{color:var(--brand)}</style></head><body><main>
<div class="k">CoinGraph · MCP server</div><h1>Connect an AI agent to CoinGraph</h1>
<p>This address is for MCP clients such as Claude, Claude Code and Cursor, not for a web browser. Add it to your client and CoinGraph's tools appear in the chat.</p>
<div class="card"><h2>Server URL</h2><pre>${esc(url)}</pre></div>
<div class="card"><h2>Claude (claude.ai or Desktop)</h2><p style="margin:0">Settings → Connectors → Add custom connector → name <code>CoinGraph</code>, URL above.</p></div>
<div class="card"><h2>Claude Code</h2><pre>claude mcp add --transport http coingraph ${esc(url)}</pre></div>
<div class="card"><h2>Cursor and JSON-config clients</h2><pre>{ "mcpServers": { "coingraph": { "url": "${esc(url)}" } } }</pre></div>
<div class="card"><h2>12 tools</h2><table>${tools.map(([n, d]) => `<tr><td><code>${n}</code></td><td>${esc(d)}</td></tr>`).join("")}</table></div>
<p>Same data as the <a href="${esc(origin)}/llms.txt">REST API</a>. CoinGraph never trades, holds funds or gives financial advice — the caller decides.</p>
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}

export async function GET(req: Request): Promise<Response> {
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html") && !accept.includes("text/event-stream")) return connectPage(process.env.COINGRAPH_PUBLIC_URL ?? new URL(req.url).origin);
  return handle(req);
}
export const POST = handle;
export const DELETE = handle;
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS });
}
