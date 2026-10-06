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

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS });
}
