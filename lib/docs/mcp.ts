import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../mcp/server";

// Lists the MCP server's tools and prompts exactly as a client sees them (tools/list, prompts/list), so the
// docs are generated from the server itself and cannot drift from it.

export type McpTool = { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } };
export type McpPrompt = { name: string; title?: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] };

let cached: Promise<{ tools: McpTool[]; prompts: McpPrompt[]; instructions?: string }> | null = null;

export function listMcp() {
  cached ??= (async () => {
    const server = buildMcpServer(null);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "coingraph-docs", version: "1.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const [{ tools }, { prompts }] = await Promise.all([client.listTools(), client.listPrompts()]);
    const instructions = client.getInstructions();
    await client.close();
    await server.close();
    return { tools: tools as McpTool[], prompts: prompts as McpPrompt[], instructions };
  })();
  return cached;
}
