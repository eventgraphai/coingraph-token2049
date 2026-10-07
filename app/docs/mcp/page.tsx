import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "../_ui/client";
import { API, C, Callout, DocPage, H2, H3, P, Step, Steps, Table, highlightJson } from "../_ui/kit";

export const metadata: Metadata = { title: "Connect", description: "Add the CoinGraph MCP server to Claude, Claude Code, Cursor or any MCP client." };

const URL = API.replace("/api/v1", "/mcp");
const json = (v: unknown) => { const t = JSON.stringify(v, null, 2); return { code: t, node: highlightJson(t) }; };

export default function McpConnect() {
  return (
    <DocPage href="/docs/mcp" eyebrow="MCP server" title="Connect CoinGraph to your assistant" lede="CoinGraph runs as a remote MCP server. Add one URL and Claude, Cursor or your own agent can check tokens, explain moves, look up addresses and run the ten agents.">
      <Table
        head={["Setting", "Value"]}
        rows={[
          ["Server URL", <C key="u">{URL}</C>],
          ["Transport", "Streamable HTTP, stateless"],
          ["Authentication", "None needed during the preview (MCP calls are free; the REST API's x402 pricing applies to direct HTTP calls)"],
          ["Capabilities", "22 tools, 3 prompts, server instructions"],
        ]}
      />

      <H2>Claude (web and desktop)</H2>
      <Steps>
        <Step title="Open connectors"><P>Go to <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</P></Step>
        <Step title="Add CoinGraph"><P>Name: <C>CoinGraph</C>. URL: <C>{URL}</C>. Save.</P></Step>
        <Step title="Use it"><P>In a new chat, enable CoinGraph from the tools menu and ask: <em>“Check Chainlink before I buy $5K. Use CoinGraph.”</em></P></Step>
      </Steps>

      <H2>Claude Code</H2>
      <CodeTabs samples={[{ label: "Terminal", code: `claude mcp add --transport http coingraph ${URL}` }]} />
      <P>Then ask in any session, or check the connection with <C>/mcp</C>.</P>

      <H2>Cursor, Windsurf and JSON-configured clients</H2>
      <P>Add CoinGraph to the client&apos;s MCP config, for Cursor <C>~/.cursor/mcp.json</C>:</P>
      <CodeTabs samples={[{ label: "mcp.json", ...json({ mcpServers: { coingraph: { url: URL } } }) }]} />

      <H3>Clients that only run local servers</H3>
      <P>Bridge the remote server with <C>mcp-remote</C>:</P>
      <CodeTabs samples={[{ label: "mcp.json", ...json({ mcpServers: { coingraph: { command: "npx", args: ["-y", "mcp-remote", URL] } } }) }]} />

      <H2>From your own agent</H2>
      <P>Any MCP client library works. With the official TypeScript SDK:</P>
      <CodeTabs samples={[{ label: "TypeScript", code: `import { Client } from "@modelcontextprotocol/sdk/client/index.js";\nimport { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";\n\nconst client = new Client({ name: "my-agent", version: "1.0.0" });\nawait client.connect(new StreamableHTTPClientTransport(new URL("${URL}")));\n\nconst result = await client.callTool({\n  name: "check_token",\n  arguments: { token: "solana", size_usd: 5000 },\n});\nconsole.log(result.content[0].text); // { object: "evaluation", data: { verdict, … } }` }]} />

      <H2>What you will see</H2>
      <P>A real exchange through the connector (7 October 2026, 10:55 UTC). The tool result is shortened; the full object is at <C>/proof/eval_d2efbaab9c51154d751d</C>.</P>
      <div className="my-5 space-y-3 text-[14px]">
        <div className="rounded-xl border border-edge bg-slab p-4"><p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">You</p><p className="mt-1 text-bone">Is it safe to buy $5K of LINK right now? Use CoinGraph.</p></div>
        <div className="rounded-xl border border-edge bg-slab p-4"><p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">Claude calls</p><p className="mt-1"><C>check_token</C> with <C>{"{ token: \"chainlink\", size_usd: 5000 }"}</C></p></div>
        <CodeTabs title="Tool result (shortened, real)" samples={[{ label: "JSON", ...json({ object: "evaluation", id: "eval_d2efbaab9c51154d751d", data: { verdict: "proceed", confidence: 0.95, dimensions: { momentum: "ok", liquidity: "ok", leverage: "ok", onchain: "ok", supply: "ok", context: "ok", contract: "ok" }, reasons: ["1h -0.81%, 24h -3.8%: nothing stretched", "$2.8M available within 2% of the price on tracked order books", "Funding 0.01% per 8h: leverage not crowded"], size_check: { order_usd: 5000, share_of_24h_volume_pct: 0.002, best_route_impact_pct: 0, dex_quote: { venue: "paraswap", price_impact_pct: 0.115 } }, onchain: "Net $2M withdrawn from exchanges in 24h — holders taking custody", verify_url: "https://token2049.coingraph.ai/api/v1/verify/eval_d2efbaab9c51154d751d" } }) }]} />
        <div className="rounded-xl border border-brand/30 bg-brand/[0.06] p-4"><p className="numerals text-[10px] uppercase tracking-[0.14em] text-brand">Claude answers</p><p className="mt-1 leading-relaxed text-bone">Yes, as far as liquidity and risk go: CoinGraph rates LINK <strong>proceed</strong> with 95% confidence. A $5K buy is 0.002% of daily volume and barely moves the price on exchange order books ($2.8M available within 2%; on-chain via ParaSwap it would cost 0.115%). Funding is 0.01% per 8h, so leverage isn&apos;t crowded, $2M net left exchanges in the last 24h, and GoPlus finds no contract risks. Momentum is soft (−3.8% in 24h) but not stretched. Proof: token2049.coingraph.ai/proof/eval_d2efbaab9c51154d751d. This is information, not advice.</p></div>
      </div>

      <H2>What to ask</H2>
      <Table
        head={["You ask", "CoinGraph tool used"]}
        rows={[
          ["“Is it safe to buy $5K of LINK right now?”", <C key="1">run_trade_gatekeeper</C>],
          ["“Why did SOL move in the last hour?”", <C key="2">get_token_brief</C>],
          ["“Are whales moving ADA onto exchanges?”", <C key="3">run_whale_watch</C>],
          ["“Who owns 5tzFkiKs…uAi9 on Solana?”", <C key="4">lookup_address</C>],
          ["“Write me a due-diligence memo on Cardano.”", <C key="5">run_due_diligence_analyst</C>],
          ["“How is the market today?”", <C key="6">run_daily_market_brief</C>],
        ]}
      />
      <Callout kind="tip">Opening the server URL in a browser shows a short connect page instead of the protocol. The full tool list is on <Link href="/docs/mcp/tools">Tools</Link>.</Callout>
    </DocPage>
  );
}
