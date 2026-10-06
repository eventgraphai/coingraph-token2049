import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "../api/handlers";
import { BASE_URL } from "../api/respond";
import { AGENTS, TIER_PRICE } from "../agents/registry";

// CoinGraph as an MCP server: the same capabilities as the REST API, as 12 tools. Every tool calls the API
// handler itself (not a copy of its logic), so validation, caching, limits and pricing behave identically.

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Reads: no side effects, results come from the outside world (markets, chains).
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;
// Work: creates a new object (a check, a brief, an answer, a watch) that is stored and graded.
const WORK = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

const tokenArg = z.string().min(1).max(100).describe("The token: a CoinGecko id (cardano, chainlink, solana), a symbol (BTC) or a contract address");

async function callApi(handler: Handler, opts: { path: string; method?: string; params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown; forwardedFor?: string | null }) {
  const url = new URL(`${BASE_URL}/api/v1${opts.path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const req = new Request(url, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.forwardedFor ? { "x-forwarded-for": opts.forwardedFor } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { content: [{ type: "text" as const, text: await res.text() }], isError: res.status >= 400 };
}

export const MCP_TOOLS = [
  "search_tokens", "get_token_snapshot", "get_token_timeline", "check_token", "get_token_brief", "ask_about_token",
  "watch_tokens", "get_market_overview", "lookup_address", "get_track_record", "get_proof", "get_service_status",
] as const;

export function buildMcpServer(forwardedFor: string | null): McpServer {
  const server = new McpServer(
    { name: "coingraph", title: "CoinGraph", version: "1.0.0", websiteUrl: BASE_URL },
    {
      instructions: [
        "CoinGraph is the check an agent runs before it acts on a crypto token.",
        "Typical flow: search_tokens to find the token → check_token before a trade (proceed / caution / avoid, with reasons) → get_token_brief to learn why it moved → ask_about_token for anything specific.",
        "Use get_token_snapshot for everything known right now, get_token_timeline for what happened over time, and get_market_overview for the whole market.",
        "Every answer says where each number came from (sources) and when it was true (as_of). Anything not measured is \"unassessed\" — never guessed.",
        "Ready-made agents (run_<agent> tools) answer whole jobs in one call: run_trade_gatekeeper before a trade (ALLOW / REDUCE / BLOCK), run_wallet_guard before signing (SAFE / WARN / STOP), run_due_diligence_analyst for a graded memo, and seven more. Each returns a verdict, a plain summary, sourced reasons and a proof id for get_proof.",
        "CoinGraph never trades, holds funds or gives financial advice. The caller decides.",
      ].join(" "),
    },
  );
  const call = (handler: Handler, opts: Parameters<typeof callApi>[1]) => callApi(handler, { ...opts, forwardedFor });

  // ---- Tokens ---------------------------------------------------------------------------------
  server.registerTool("search_tokens", {
    title: "Search tokens",
    description: "Find a token. With no input, lists the 100 tokens CoinGraph tracks with price, 1h and 24h change, open signals and the latest headline. With `query`, searches 21,000+ tokens by name, symbol or contract address and says whether each one is tracked. Use this first to get the token id.",
    inputSchema: { query: z.string().max(100).optional().describe("Name, symbol or contract address to search for. Leave empty to list the tracked tokens") },
    annotations: { title: "Search tokens", ...READ },
  }, ({ query }) => call(api.tokens, { path: "/tokens", query: { q: query } }));

  server.registerTool("get_token_snapshot", {
    title: "Get token snapshot",
    description: "Everything CoinGraph knows about a token right now, in one answer: price and market data, liquidity and order-book depth, futures (open interest, funding, long/short, liquidations), onchain flows to and from exchanges, large transfers, exchange reserves, supply, contract security (honeypot, mint/freeze powers, taxes), news, TVL, developer activity, open signals and the latest brief. Each part says its source and age. Pass `sections` to get only some parts.",
    inputSchema: {
      token: tokenArg,
      sections: z.string().optional().describe("Optional comma list of parts: identity, market, liquidity, derivatives, onchain, supply, security, context, signals, brief. Default: all"),
    },
    annotations: { title: "Get token snapshot", ...READ },
  }, ({ token, sections }) => call(api.state, { path: `/state/${encodeURIComponent(token)}`, params: { token }, query: { sections } }));

  server.registerTool("get_token_timeline", {
    title: "Get token timeline",
    description: "What happened to a token over time. Charts: price, 1-minute candles, open interest, funding, long/short ratios, exchange net flow, exchange reserves and TVL. Events: large transfers, liquidations, signals, headlines and briefs, each with a timestamp. Default window: last 24 hours of events and 14 days of charts.",
    inputSchema: {
      token: tokenArg,
      since: z.string().optional().describe("Optional ISO-8601 time to start from, e.g. 2026-10-06T00:00:00Z"),
      series: z.string().optional().describe("Optional comma list of charts to include: price, candles, open_interest, funding, long_short, exchange_net_flow, reserves, tvl"),
    },
    annotations: { title: "Get token timeline", ...READ },
  }, ({ token, since, series }) => call(api.history, { path: `/history/${encodeURIComponent(token)}`, params: { token }, query: { since, series } }));

  server.registerTool("check_token", {
    title: "Check token before acting",
    description: "The check to run before acting on a token. Returns a verdict — proceed, caution or avoid — rated across momentum, liquidity, leverage, onchain flows, supply, context and contract, with the reasons and their sources. Add `size_usd` to see how your order compares with available liquidity, and `policy` to test your own rules. Each check gets an id you can prove later with get_proof.",
    inputSchema: {
      token: tokenArg,
      size_usd: z.number().positive().optional().describe("Optional: your intended order size in US dollars"),
      policy: z.object({
        min_depth_usd: z.number().optional().describe("Minimum liquidity within 2% of the price"),
        max_top10_holder_pct: z.number().optional().describe("Maximum share of supply held by the top 10 holders"),
        max_funding_pct: z.number().optional().describe("Maximum futures funding rate per 8 hours, in percent"),
        max_exchange_inflow_usd: z.number().optional().describe("Maximum net USD moved onto exchanges in 24 hours"),
        max_unlock_pct: z.number().optional().describe("Maximum token unlock (currently reported as unknown)"),
        allow_mint_authority: z.boolean().optional().describe("Whether a contract that can still mint is acceptable (currently reported as unknown)"),
      }).optional().describe("Optional: your rules; each one is reported as pass, fail or unknown"),
    },
    annotations: { title: "Check token before acting", ...WORK },
  }, ({ token, size_usd, policy }) => (size_usd !== undefined || policy !== undefined)
    ? call(api.evaluatePost, { path: "/evaluate", method: "POST", body: { token, size_usd, policy } })
    : call(api.evaluateGet, { path: `/evaluate/${encodeURIComponent(token)}`, params: { token } }));

  server.registerTool("get_token_brief", {
    title: "Get token brief",
    description: "Why did this token move? Returns CoinGraph's brief: a headline, what happened, the likely causes with confidence, the onchain evidence (whale moves, exchange flows), market context and what to watch next. Every statement cites the evidence behind it. Returns the latest brief; set `fresh` to true to run a new investigation now (takes about a minute).",
    inputSchema: {
      token: tokenArg,
      fresh: z.boolean().optional().describe("Optional: true to run a new investigation instead of returning the latest brief"),
      hours: z.number().min(1).max(24).optional().describe("Optional, with fresh: how many hours back to investigate (default 2)"),
    },
    annotations: { title: "Get token brief", ...WORK },
  }, ({ token, fresh, hours }) => fresh
    ? call(api.explainPost, { path: "/explain", method: "POST", body: { token, hours } })
    : call(api.explainGet, { path: `/explain/${encodeURIComponent(token)}`, params: { token } }));

  server.registerTool("ask_about_token", {
    title: "Ask about a token",
    description: "Ask CoinGraph anything about a token, or test whether a statement is true. A `question` gets a plain answer with key points and their evidence. A `claim` gets a verdict — supported, contradicted or unknown — with the reasoning. Provide exactly one of the two. Takes 20–40 seconds.",
    inputSchema: {
      token: tokenArg,
      question: z.string().min(3).max(500).optional().describe("A question, e.g. \"Is leverage crowded right now?\""),
      claim: z.string().min(3).max(500).optional().describe("A statement to test, e.g. \"Whales are moving this token onto exchanges\""),
    },
    annotations: { title: "Ask about a token", ...WORK },
  }, ({ token, question, claim }) => call(api.askPost, { path: "/ask", method: "POST", body: { token, question, claim } }));

  server.registerTool("watch_tokens", {
    title: "Watch tokens",
    description: "Watch up to 50 tokens and get told when something important happens. CoinGraph sends a signed message to your webhook URL when a signal fires (price, volume, whale transfer, liquidations, exchange flows, news…) or a new brief is written. Returns a watch id and a secret that verifies each message (shown once — keep it).",
    inputSchema: {
      tokens: z.array(z.string()).min(1).max(50).describe("Token ids to watch"),
      webhook_url: z.string().url().describe("Public https URL that receives the messages"),
      min_severity: z.number().int().min(1).max(3).optional().describe("Optional: only send signals at or above this severity, 1 (low) to 3 (high). Default 2"),
      kinds: z.array(z.string()).optional().describe("Optional: only these signal kinds, e.g. whale_transfer, exchange_inflow, price_move"),
    },
    annotations: { title: "Watch tokens", ...WORK },
  }, ({ tokens, webhook_url, min_severity, kinds }) => call(api.monitorPost, { path: "/monitor", method: "POST", body: { tokens, webhook_url, conditions: { min_severity, kinds } } }));

  // ---- Market and addresses --------------------------------------------------------------------
  server.registerTool("get_market_overview", {
    title: "Get market overview",
    description: "The whole crypto market at a glance: total market cap and volume, BTC and ETH dominance, sectors, how many tokens are up or down, Fear & Greed, stablecoins moving to exchanges, network fees, exchange outages, rankings (top gainers and losers, volume spikes, whale activity, exchange inflows and outflows) and the latest market-wide events. Pass `sections` to get only some parts.",
    inputSchema: { sections: z.string().optional().describe("Optional comma list: overview, sectors, breadth, sentiment, flows, chains, venues, rankings, events, pulse. Default: all") },
    annotations: { title: "Get market overview", ...READ },
  }, ({ sections }) => call(api.market, { path: "/market", query: { sections } }));

  server.registerTool("lookup_address", {
    title: "Look up an address",
    description: "Who is behind a blockchain address? Returns its label (an exchange such as Binance, a contract, a burn address, or unlabelled), a screening result (OFAC sanctions, scam/phishing flags), what kind of address it is (exchange, whale, new wallet…), its balances, how many transactions it has made and its recent large transfers. Read live from the chain.",
    inputSchema: {
      chain: z.enum(["eth", "bsc", "btc", "sol", "ada"]).describe("The chain: eth (Ethereum), bsc (BNB Chain), btc (Bitcoin), sol (Solana) or ada (Cardano)"),
      address: z.string().min(20).max(130).describe("The address on that chain"),
    },
    annotations: { title: "Look up an address", ...READ },
  }, ({ chain, address }) => call(api.inspect, { path: `/inspect/${chain}/${encodeURIComponent(address)}`, params: { chain, address: encodeURIComponent(address) } }));

  // ---- Trust ------------------------------------------------------------------------------------
  server.registerTool("get_track_record", {
    title: "Get track record",
    description: "CoinGraph's public scorecard. Every check, signal and brief it issued, what it said, what the price did 1 hour, 24 hours and 7 days later, and whether the call was right — plus the overall hit rate by kind and severity. Pass `token` for one token only.",
    inputSchema: {
      token: z.string().max(100).optional().describe("Optional: limit to one token"),
      since: z.string().optional().describe("Optional ISO-8601 time; default the last 7 days"),
      kind: z.enum(["evaluation", "signal", "brief"]).optional().describe("Optional: only checks (evaluation), signals or briefs"),
    },
    annotations: { title: "Get track record", ...READ },
  }, ({ token, since, kind }) => token
    ? call(api.record, { path: `/record/${encodeURIComponent(token)}`, params: { token }, query: { since, kind } })
    : call(api.record, { path: "/record", query: { since, kind } }));

  server.registerTool("get_proof", {
    title: "Get proof",
    description: "Proof of exactly what CoinGraph told you. Give the id of a check (eval_…), an answer (ans_…), an agent run (run_…) or a brief (a number) and get the original object, its SHA-256 fingerprint, the Chainlink attestation status and the list of data-source calls behind it.",
    inputSchema: { id: z.string().min(1).max(60).describe("The id from a previous answer: eval_…, ans_…, run_… or a brief number") },
    annotations: { title: "Get proof", ...READ },
  }, ({ id }) => call(api.verify, { path: `/verify/${encodeURIComponent(id)}`, params: { id } }));

  server.registerTool("get_service_status", {
    title: "Get service status",
    description: "Is CoinGraph working right now? Shows whether data collection is healthy, how fresh each data source is, what is covered (tokens, exchanges, chains), the current prices and the payment details.",
    inputSchema: {},
    annotations: { title: "Get service status", ...READ },
  }, () => call(api.status, { path: "/status" }));

  // ---- Agents: one tool per agent ------------------------------------------------------------------
  for (const def of AGENTS) {
    const name = `run_${def.id.replace(/-/g, "_")}`;
    server.registerTool(name, {
      title: def.name,
      description: `${def.tagline} ${def.description} Returns one of: ${def.verdicts.join(" / ")}, with a plain summary, structured result, sourced reasons and a proof id. Price: ${TIER_PRICE[def.tier].tada} tADA on testnet (${def.tier}).`,
      inputSchema: def.input,
      annotations: { title: def.name, ...WORK },
    }, (args: unknown) => call(api.agentRun, { path: `/agents/${def.id}`, method: "POST", params: { id: def.id }, body: args as Record<string, unknown> }));
  }

  // ---- Prompts: the flagship workflows as slash commands ------------------------------------------
  server.registerPrompt("pre_trade_check", {
    title: "Pre-trade check",
    description: "Run the Trade Gatekeeper before placing a trade and explain the decision.",
    argsSchema: { token: z.string().describe("Token, e.g. chainlink"), size_usd: z.string().describe("Order size in USD, e.g. 5000"), side: z.string().optional().describe("buy or sell (default buy)") },
  }, ({ token, size_usd, side }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Before I ${side ?? "buy"} $${size_usd} of ${token}, run CoinGraph's run_trade_gatekeeper tool with token "${token}", size_usd ${Number(size_usd) || 5000} and side "${side ?? "buy"}". Then tell me the decision (ALLOW / REDUCE / BLOCK) in one line, the top 3 reasons with their sources, the safe size if it says REDUCE, and the proof link. If the check mentions a brief, call get_token_brief and summarise why the token moved.` } }],
  }));
  server.registerPrompt("wallet_safety_check", {
    title: "Wallet safety check",
    description: "Check a token swap and/or a recipient address with Wallet Guard before signing.",
    argsSchema: { token: z.string().optional().describe("Token you are swapping into"), amount_usd: z.string().optional(), to_address: z.string().optional().describe("Recipient address"), chain: z.string().optional().describe("eth, bsc, btc, sol or ada") },
  }, ({ token, amount_usd, to_address, chain }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Use CoinGraph's run_wallet_guard tool with ${JSON.stringify({ token, amount_usd: amount_usd ? Number(amount_usd) : undefined, to_address, chain })}. Give me SAFE / WARN / STOP first, then the reasons in plain language. If it says STOP, tell me clearly not to sign.` } }],
  }));
  server.registerPrompt("token_due_diligence", {
    title: "Token due diligence",
    description: "Produce a due-diligence memo on a token with the Due Diligence Analyst.",
    argsSchema: { token: z.string().describe("Token, e.g. cardano") },
  }, ({ token }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Run CoinGraph's run_due_diligence_analyst tool for "${token}". Present the overall grade, a table of the section grades with their key findings, the red flags and strengths, and the proof link. Don't add facts that aren't in the result.` } }],
  }));

  return server;
}
