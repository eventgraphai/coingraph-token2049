import Link from "next/link";
import type { ReactNode } from "react";
import type { Param } from "../_ui/kit";

// API reference content. One entry per endpoint page; app/docs/api/[endpoint] renders them all the same way.

export type Tier = "Free" | "Data" | "Premium" | "Free · Premium" | "Premium · Pro";
export type Operation = { method: "GET" | "POST" | "DELETE"; path: string; summary: string; params: Param[]; example?: string; exampleLabel?: string };
export type EndpointDoc = {
  slug: string; title: string; lede: string; group: "Discover" | "Understand" | "Decide" | "Watch" | "Trust" | "Agents"; tier: Tier; mcp?: string;
  intro: ReactNode; operations: Operation[]; returns: [string, ReactNode][]; notes?: ReactNode;
};

const token = (inWhere = "path"): Param => ({ name: "token", type: "string", required: true, in: inWhere, description: <>Token id (<code>cardano</code>, <code>chainlink</code>, <code>solana</code>), symbol (<code>ADA</code>, <code>LINK</code>, <code>SOL</code>) or contract address.</> });

export const ENDPOINT_DOCS: EndpointDoc[] = [
  {
    slug: "tokens", group: "Discover", tier: "Free", mcp: "search_tokens",
    title: "List & search tokens", lede: "The 100 tokens CoinGraph tracks in depth, or a search across 21,000+ coins.",
    intro: <>Start here to find the id CoinGraph uses for a token. Without <code>q</code> you get the tracked universe with price, 1-hour and 24-hour change, open signals and the latest headline. With <code>q</code> you search by name, symbol or contract address, and each result says whether it is tracked in depth.</>,
    operations: [{ method: "GET", path: "/v1/tokens", summary: "List or search tokens", params: [{ name: "q", type: "string", in: "query", description: "Name, symbol or contract address, e.g. chainlink, LINK or 0x5149…86ca." }], example: "tokens", exampleLabel: "Search for Chainlink" }],
    returns: [["count", "Number of tokens returned."], ["tokens[] / results[]", <>Per token: <code>id</code>, <code>symbol</code>, <code>name</code>, <code>rank</code>, <code>chains</code> (contract per chain), <code>price_usd</code>, <code>change_1h_pct</code>, <code>change_24h_pct</code>, <code>categories</code>, <code>open_signals</code>, <code>latest_headline</code>, <code>tracked</code>.</>]],
  },
  {
    slug: "status", group: "Discover", tier: "Free", mcp: "get_service_status",
    title: "Service status", lede: "Is CoinGraph healthy right now, how fresh is the data, and what does it cost?",
    intro: <>Agents should call this before depending on CoinGraph in a live workflow. It reports the pipeline state, the age of every data source, coverage, current prices and the payment details.</>,
    operations: [{ method: "GET", path: "/v1/status", summary: "Pipeline health and freshness", params: [], example: "status" }],
    returns: [["pipeline", <><code>ok</code> or <code>degraded</code>.</>], ["feeds", "Each data source with its last update and status."], ["freshness", "Newest data per category (market, futures, onchain, context)."], ["coverage", "Tokens, exchanges and chains covered."], ["pricing / payment", "Current phase, prices and the Cardano payment details."]],
  },
  {
    slug: "state", group: "Understand", tier: "Data", mcp: "get_token_snapshot",
    title: "Token state", lede: "Everything CoinGraph knows about a token right now, in one object.",
    intro: <>One call replaces a dozen integrations. The state is split into sections; ask only for the ones you need with <code>sections</code>. Every section carries its own <code>as_of</code> and <code>sources</code>, and anything CoinGraph cannot measure is the string <code>&quot;unassessed&quot;</code>.</>,
    operations: [{ method: "GET", path: "/v1/state/{token}", summary: "Current state of a token", params: [token(), { name: "sections", type: "string", in: "query", description: <>Comma list: <code>identity, market, liquidity, derivatives, onchain, supply, security, context, signals, brief</code>. Default: all.</> }], example: "state", exampleLabel: "Chainlink: market, liquidity and contract security" }],
    returns: [
      ["identity", "Name, symbol, chains and contracts, categories, links, where it trades."],
      ["market", "Price, market cap, FDV, volume, changes from 15 minutes to 1 year, ATH/ATL, volatility, beta to BTC."],
      ["liquidity", "Order-book depth within 2% and spread per exchange, cost to move the price ±2%, DEX pools, price dispersion."],
      ["derivatives", "Open interest and its change, funding per venue, long/short ratios, taker flow, liquidations, basis, leverage ratio."],
      ["onchain", "Exchange inflow, outflow and net flow, large transfers tagged with exchange names, exchange reserves, holder concentration, fees."],
      ["supply", <>Circulating, total and max supply, FDV ratio, exchange-held and top-holder share. <code>unlocks</code> is <code>&quot;unassessed&quot;</code>.</>],
      ["security", "Contract risk from GoPlus on the home chain: honeypot test, mint, pause, blacklist and owner powers, taxes, upgradeability."],
      ["context", "News, protocol TVL, developer activity, community, trending rank, Fear & Greed."],
      ["signals / brief", "Open signals, and the latest brief's headline (full text via Explain)."],
    ],
  },
  {
    slug: "history", group: "Understand", tier: "Data", mcp: "get_token_timeline",
    title: "Token history", lede: "What happened to a token over time: charts and events.",
    intro: <>Series are time-ordered points for charts and models; events are discrete things that happened, each with a timestamp. Defaults: 24 hours of events and 14 days of series.</>,
    operations: [{ method: "GET", path: "/v1/history/{token}", summary: "Series and events", params: [token(), { name: "since", type: "ISO-8601", in: "query", description: "Start time, e.g. 2026-10-06T00:00:00Z." }, { name: "series", type: "string", in: "query", description: <>Comma list: <code>price, candles, open_interest, funding, long_short, exchange_net_flow, reserves, tvl</code>.</> }], example: "history", exampleLabel: "Solana: price and funding for the last 6 hours" }],
    returns: [["series", "price (5-minute for 14 days, hourly to 30 days), market cap, volume, 1-minute candles, open interest, funding, long/short, exchange net flow (15-minute), reserves (hourly), TVL."], ["events", "Large transfers (from, to, exchange tags, tx hash), liquidations, signals, headlines and briefs."]],
  },
  {
    slug: "market", group: "Understand", tier: "Data", mcp: "get_market_overview",
    title: "Market overview", lede: "The whole crypto market at a glance.",
    intro: <>Use this for context before acting on a single token: is the whole market risk-on, are stablecoins moving onto exchanges, which sectors lead?</>,
    operations: [{ method: "GET", path: "/v1/market", summary: "Market-wide state", params: [{ name: "sections", type: "string", in: "query", description: <>Comma list: <code>overview, sectors, breadth, sentiment, flows, chains, venues, rankings, events, pulse</code>. Default: all.</> }], example: "market", exampleLabel: "Overview, breadth and sentiment" }],
    returns: [["overview", "Total market cap and volume, 24h change, BTC and ETH dominance."], ["sectors", "Market cap and change per category."], ["breadth", "Share of the top 100 up or down over 1h and 24h."], ["sentiment", "Fear & Greed with history, trending searches."], ["flows", "Stablecoins to and from exchanges, biggest inflows and outflows."], ["chains / venues", "Network fees, Bitcoin mempool, exchange outages."], ["rankings / events / pulse", "Top movers, volume spikes, whale activity; the last 24h of events; the hourly written market brief."]],
  },
  {
    slug: "inspect", group: "Understand", tier: "Premium", mcp: "lookup_address",
    title: "Inspect an address", lede: "Who is behind an address, read live from the chain.",
    intro: <>Labels come from CoinGraph&apos;s exchange-wallet map; balances and activity are read live through NOWNodes on Ethereum, BNB Chain, Bitcoin, Solana and Cardano. Every lookup is screened against the OFAC sanctions list and GoPlus address flags.</>,
    operations: [{ method: "GET", path: "/v1/inspect/{chain}/{address}", summary: "Address profile", params: [{ name: "chain", type: '"eth" | "bsc" | "btc" | "sol" | "ada"', required: true, in: "path", description: "The chain." }, { name: "address", type: "string", required: true, in: "path", description: "The address on that chain." }], example: "inspect", exampleLabel: "A Binance hot wallet on Solana" }],
    returns: [["label", "Exchange name, contract, burn address or unlabelled."], ["type", "exchange, contract, whale, new wallet or regular."], ["screening", "OFAC sanctions and scam or phishing flags."], ["balances / tx_count", "Native and token balances with USD values, transaction count."], ["recent_large_moves", "Recent large transfers."]],
  },
  {
    slug: "evaluate", group: "Decide", tier: "Free · Premium", mcp: "check_token",
    title: "Evaluate a token", lede: "Should you act on this token right now? Proceed, caution or avoid, with reasons.",
    intro: <>The core check. Seven dimensions are rated <code>ok</code>, <code>caution</code> or <code>avoid</code> from live data, and the worst of them drives the verdict. <code>GET</code> is the standard check and is free. <code>POST</code> scores it against your order size and your own rules.</>,
    operations: [
      { method: "GET", path: "/v1/evaluate/{token}", summary: "Standard check", params: [token()], example: "evaluate_get", exampleLabel: "Chainlink, standard check" },
      { method: "POST", path: "/v1/evaluate", summary: "Check sized to your order and rules", params: [token("body"), { name: "size_usd", type: "number", in: "body", description: "Your intended order size in USD. Adds a size check against order-book depth, daily volume and the best on-chain route." }, { name: "policy", type: "object", in: "body", description: <>Your rules, each reported pass, fail or unknown: <code>min_depth_usd</code>, <code>max_top10_holder_pct</code>, <code>max_funding_pct</code>, <code>max_exchange_inflow_usd</code>, <code>allow_mint_authority</code>, <code>max_unlock_pct</code>.</> }], example: "evaluate_post", exampleLabel: "Solana, $5K order with three rules" },
    ],
    returns: [["verdict", <><code>proceed</code>, <code>caution</code> or <code>avoid</code>.</>], ["confidence", "0 to 1: how much of the data was available and fresh."], ["dimensions", "momentum, liquidity, leverage, onchain, supply, context, contract: each with a rating, reasons and sources."], ["reasons", "The statements that drive the verdict, each with its source."], ["size_check (POST)", "Your order against 2% depth and daily volume, estimated impact, best on-chain quote."], ["policy_check (POST)", "pass, fail or unknown per rule."], ["watch_next", "What would change the verdict."], ["id, verify_url", "For the public record and the proof."]],
    notes: <>Reasons marked <code>info</code> are context only and never move the verdict.</>,
  },
  {
    slug: "explain", group: "Decide", tier: "Free · Premium", mcp: "get_token_brief",
    title: "Explain a move", lede: "Why did this token move? A brief where every statement cites its evidence.",
    intro: <>When the signal engine sees something unusual it opens an investigation: it gathers market, futures, onchain and news evidence, makes live lookups on the wallets involved, and Claude writes a brief that may only state what the evidence supports. <code>GET</code> returns the latest brief; <code>POST</code> runs a fresh investigation (about 60 seconds).</>,
    operations: [
      { method: "GET", path: "/v1/explain/{token}", summary: "Latest brief", params: [token()], example: "explain", exampleLabel: "Chainlink's latest brief" },
      { method: "GET", path: "/v1/explain/{token}/{id}", summary: "A specific past brief", params: [token(), { name: "id", type: "integer", required: true, in: "path", description: "Brief number." }] },
      { method: "POST", path: "/v1/explain", summary: "Run a fresh investigation", params: [token("body"), { name: "hours", type: "number (1–24)", in: "body", default: "2", description: "How far back to investigate." }] },
    ],
    returns: [["headline, summary", "One line and one paragraph."], ["direction, severity, confidence", "bullish / bearish / neutral, 1 to 3, 0 to 1."], ["what_happened, likely_causes, onchain, market_context", "Claims, each citing evidence ids such as e3 or e7."], ["watch_next, caveats", "What would confirm or contradict it, and what is uncertain."], ["evidence[]", "Every item: id, kind, source, summary and the raw data."]],
  },
  {
    slug: "ask", group: "Decide", tier: "Premium", mcp: "ask_about_token",
    title: "Ask or check a claim", lede: "A cited answer to a question, or a verdict on a claim.",
    intro: <>Send exactly one of <code>question</code> or <code>claim</code>. A question gets a plain answer with key points and their evidence. A claim gets <code>supported</code>, <code>contradicted</code> or <code>unknown</code>. Takes 20 to 40 seconds.</>,
    operations: [{ method: "POST", path: "/v1/ask", summary: "Question or claim", params: [token("body"), { name: "question", type: "string (3–500)", in: "body", description: "A question, e.g. “Are large holders moving ADA onto exchanges today?”" }, { name: "claim", type: "string (3–500)", in: "body", description: "A statement to test, e.g. “SOL futures are crowded long.”" }], example: "ask_question", exampleLabel: "A question about Cardano" }],
    returns: [["answer / verdict", "Plain-text answer, or supported / contradicted / unknown."], ["key_points / reasoning", "Each with the evidence it rests on."], ["confidence", "0 to 1."], ["evidence[], id, verify_url", "The inputs, and the proof."]],
    notes: "claim",
  },
  {
    slug: "monitor", group: "Watch", tier: "Premium", mcp: "watch_tokens",
    title: "Monitors & webhooks", lede: "Get a signed webhook when a signal fires, a verdict changes or a brief is written.",
    intro: <>Create a monitor for up to 50 tokens. CoinGraph POSTs to your HTTPS endpoint and signs every message with HMAC-SHA256 in the <code>X-CoinGraph-Signature</code> header. The <code>secret</code> is returned once; keep it to verify messages and to manage the monitor.</>,
    operations: [
      { method: "POST", path: "/v1/monitor", summary: "Create a monitor", params: [{ name: "tokens", type: "string[] (1–50)", required: true, in: "body", description: "Token ids to watch." }, { name: "webhook_url", type: "https URL", required: true, in: "body", description: "Public HTTPS endpoint. Private and internal addresses are rejected." }, { name: "conditions", type: "object", in: "body", description: <><code>kinds[]</code> (signal kinds), <code>min_severity</code> 1–3 (default 2), <code>verdict_changes</code>, <code>new_briefs</code>.</> }], example: "monitor", exampleLabel: "Watch ADA, LINK and SOL" },
      { method: "GET", path: "/v1/monitor", summary: "List your monitors", params: [{ name: "X-Monitor-Secret", type: "string", required: true, in: "header", description: "The secret from creation." }] },
      { method: "DELETE", path: "/v1/monitor/{id}", summary: "Stop a monitor", params: [{ name: "id", type: "string", required: true, in: "path", description: "Monitor id." }, { name: "X-Monitor-Secret", type: "string", required: true, in: "header", description: "The secret from creation." }] },
    ],
    returns: [["id, secret", "The monitor id and its signing secret (shown once)."], ["tokens, conditions, created_at", "What is watched and how."]],
    notes: "webhook",
  },
  {
    slug: "record", group: "Trust", tier: "Free", mcp: "get_track_record",
    title: "Track record", lede: "Every call CoinGraph made, what happened next, and whether it was right.",
    intro: <>The public ledger of checks, signals and briefs. Each entry has the price when it was issued and 1 hour, 24 hours and 7 days later. Directional calls are graded on the 24-hour return; <code>caution</code> is graded right when the price moved 2% or more either way. See <Link href="/docs/proofs">Proofs & track record</Link>.</>,
    operations: [
      { method: "GET", path: "/v1/record", summary: "The whole ledger", params: [{ name: "since", type: "ISO-8601", in: "query", description: "Default: the last 7 days." }, { name: "kind", type: '"evaluation" | "signal" | "brief"', in: "query", description: "Only one kind of call." }] },
      { method: "GET", path: "/v1/record/{token}", summary: "One token's ledger", params: [token(), { name: "since", type: "ISO-8601", in: "query", description: "Default: the last 7 days." }, { name: "kind", type: '"evaluation" | "signal" | "brief"', in: "query", description: "Only one kind of call." }], example: "record", exampleLabel: "Solana's signals" },
    ],
    returns: [["ledger[]", "kind, id, token, at, what was said, direction, price then and after, graded_on, outcome."], ["calibration", "Totals, hit rate by kind and severity, and the grading method."]],
  },
  {
    slug: "verify", group: "Trust", tier: "Free", mcp: "get_proof",
    title: "Verify a proof", lede: "The exact object CoinGraph issued, its SHA-256 fingerprint and the source calls behind it.",
    intro: <>Every check, answer, brief and agent run is stored exactly as it was returned. This endpoint recomputes its fingerprint so you can confirm nothing changed, and lists the data-source calls made around the time it was issued. People can open the same proof at <code>/proof/&#123;id&#125;</code> on the website.</>,
    operations: [{ method: "GET", path: "/v1/verify/{id}", summary: "Proof for an id", params: [{ name: "id", type: "string", required: true, in: "path", description: <><code>eval_…</code>, <code>ans_…</code>, <code>run_…</code> or a brief number.</> }], example: "verify", exampleLabel: "Proof for the Chainlink check above" }],
    returns: [["sha256", "Fingerprint of the canonical JSON (sorted keys, no spaces)."], ["hash_matches_stored", "true when it matches the fingerprint stored at issue time."], ["attestation", <>Chainlink CRE attestation: <code>status</code>, <code>mode</code> (<code>simulation</code> today), <code>workflow</code>, <code>consensus</code>, <code>attested_at</code>; <code>pending</code> until the workflow has reached the proof.</>], ["object", "The exact object issued."], ["provenance[]", "Source calls: provider, endpoint, time, latency, ok."]],
  },
  {
    slug: "agents", group: "Agents", tier: "Premium · Pro", mcp: "run_<agent>",
    title: "Agents", lede: "List the ten ready-made agents and run one over REST.",
    intro: <>Each agent does a whole job in one call and returns a verdict, a plain summary, a structured result, sourced reasons and a proof id. Inputs differ per agent; see <Link href="/docs/agents">Agents</Link> for each one.</>,
    operations: [
      { method: "GET", path: "/v1/agents", summary: "Catalog with input schemas", params: [] },
      { method: "GET", path: "/v1/agents/{id}", summary: "One agent's card", params: [{ name: "id", type: "string", required: true, in: "path", description: "e.g. trade-gatekeeper." }] },
      { method: "POST", path: "/v1/agents/{id}", summary: "Run an agent", params: [{ name: "id", type: "string", required: true, in: "path", description: "e.g. trade-gatekeeper." }, { name: "body", type: "object", required: true, in: "body", description: "The agent's input; see its page." }], example: "agent:trade-gatekeeper", exampleLabel: "Trade Gatekeeper: buy $5K of SOL" },
    ],
    returns: [["run_id, agent, verdict, summary", "The decision in one line."], ["result", "The structured answer, different per agent."], ["reasons[], warnings[]", "Why, each with its source."], ["hash, verify_url", "The proof."]],
  },
];

export const ENDPOINT_BY_SLUG = Object.fromEntries(ENDPOINT_DOCS.map((e) => [e.slug, e]));
