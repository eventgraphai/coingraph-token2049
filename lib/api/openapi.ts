import { BASE_URL } from "./respond";
import { PRICES, PRICING_NOTES } from "./pricing";

// OpenAPI 3.1 for the 12 endpoints, generated from the same descriptions as docs/API.md.

const envelope = (object: string, dataRef: string) => ({
  type: "object",
  properties: { object: { type: "string", const: object }, id: { type: ["string", "null"] }, as_of: { type: "string", format: "date-time" }, data: { $ref: dataRef }, sources: { type: "array", items: { $ref: "#/components/schemas/Source" } } },
  required: ["object", "as_of", "data", "sources"],
});
const err = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const tokenParam = { name: "token", in: "path", required: true, description: "Token id (coingecko id), symbol or contract address.", schema: { type: "string" }, example: "aave" };
const sectionsParam = (values: string[]) => ({ name: "sections", in: "query", required: false, description: `Comma-separated list of sections to return. Default: all. Valid: ${values.join(", ")}.`, schema: { type: "string" } });
const sinceParam = { name: "since", in: "query", required: false, description: "ISO-8601 time. Limits events (and series) to after this time.", schema: { type: "string", format: "date-time" } };
const resp = (object: string, schema: string, description: string) => ({ 200: { description, content: { "application/json": { schema: envelope(object, `#/components/schemas/${schema}`) } } }, 400: err, 404: err, 429: err });
const paid = (key: string) => (PRICES[key] ? ` **Paid:** ${PRICES[key].label} via x402 (402 Payment Required → pay → retry with X-Payment).` : " Free.");

export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "CoinGraph API", version: "1.0.0",
      summary: "The check before they act: verified crypto market intelligence for AI agents.",
      description: `Humans read it, agents call it. Every response carries where the data came from (sources) and when it was true (as_of); anything unmeasured is "unassessed". CoinGraph never executes, custodies or advises — the caller decides.\n\nPhase: ${PRICING_NOTES.phase}. ${PRICING_NOTES.summary}`,
      contact: { name: "CoinGraph", url: "https://coingraph.ai", email: "ajay@coingraph.ai" },
    },
    servers: [{ url: `${BASE_URL}/api/v1`, description: "TOKEN2049 build" }],
    tags: [
      { name: "Discover", description: "Find what CoinGraph covers and whether it is healthy. Free." },
      { name: "Understand", description: "Everything CoinGraph knows, as data." },
      { name: "Decide", description: "Ask CoinGraph to think. Creates objects with ids that go into the public record." },
      { name: "Watch", description: "Get told when something changes." },
      { name: "Trust", description: "Check CoinGraph's record and prove what you were told." },
    ],
    paths: {
      "/tokens": { get: { tags: ["Discover"], operationId: "tokens", summary: "List the 100 tokens we track", description: "Ids, symbols, contract addresses per chain, rank, price, changes, categories, open signals, latest headline. Use `q` to search 21,000+ coins by name, symbol or contract." + paid("GET /v1/tokens"), parameters: [{ name: "q", in: "query", required: false, schema: { type: "string" }, example: "aave" }], responses: resp("token_list", "TokenList", "The tracked universe") } },
      "/status": { get: { tags: ["Discover"], operationId: "status", summary: "Is CoinGraph healthy right now?", description: "Pipeline health, data freshness, coverage, prices and the payment address.", responses: resp("service_status", "ServiceStatus", "Service status") } },
      "/state/{token}": { get: { tags: ["Understand"], operationId: "state", summary: "Everything we know about a token right now", description: "Sections: identity, market, liquidity, derivatives, onchain, supply, context, signals, brief. Each section carries its own sources and as_of." + paid("GET /v1/state"), parameters: [tokenParam, sectionsParam(["identity", "market", "liquidity", "derivatives", "onchain", "supply", "context", "signals", "brief"])], responses: resp("state", "State", "Unified token state") } },
      "/history/{token}": { get: { tags: ["Understand"], operationId: "history", summary: "What happened to a token over time", description: "Series (price, candles, open interest, funding, long/short, exchange net flow, reserves, TVL) and events (large transfers, liquidations, signals, headlines, briefs). Default window: 24h events, 14 days series." + paid("GET /v1/history"), parameters: [tokenParam, sinceParam, { name: "series", in: "query", required: false, description: "Comma list of series to include.", schema: { type: "string" } }], responses: resp("history", "History", "Series and events") } },
      "/market": { get: { tags: ["Understand"], operationId: "market", summary: "The whole market at a glance", description: "Sections: overview, sectors, breadth, sentiment, flows, chains, venues, rankings, events, pulse." + paid("GET /v1/market"), parameters: [sectionsParam(["overview", "sectors", "breadth", "sentiment", "flows", "chains", "venues", "rankings", "events", "pulse"])], responses: resp("market", "MarketState", "Market-wide state") } },
      "/inspect/{chain}/{address}": { get: { tags: ["Understand"], operationId: "inspect", summary: "Who owns an address?", description: "Label (exchange, contract, burn or unlabelled), type, balances, transaction count, recent large moves. Fetched live from the chain through NOWNodes." + paid("GET /v1/inspect"), parameters: [{ name: "chain", in: "path", required: true, schema: { type: "string", enum: ["eth", "bsc", "btc", "sol", "ada"] } }, { name: "address", in: "path", required: true, schema: { type: "string" } }], responses: resp("address_profile", "AddressProfile", "Address profile") } },
      "/evaluate/{token}": { get: { tags: ["Decide"], operationId: "evaluateGet", summary: "Should you act on this token right now? (standard check)", description: "Verdict proceed / caution / avoid per dimension (momentum, liquidity, leverage, onchain, supply, context, contract) with reasons and sources. Independent of order size." + paid("GET /v1/evaluate"), parameters: [tokenParam], responses: resp("evaluation", "Evaluation", "Evaluation") } },
      "/evaluate": { post: { tags: ["Decide"], operationId: "evaluate", summary: "Should you act on this token right now? (with your size and rules)", description: "Same verdict, scored against your order size (vs depth and daily volume) and your policy rules." + paid("POST /v1/evaluate"), requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EvaluateRequest" } } } }, responses: { 201: { description: "Evaluation", content: { "application/json": { schema: envelope("evaluation", "#/components/schemas/Evaluation") } } }, 400: err, 402: err, 404: err, 429: err } } },
      "/explain/{token}": { get: { tags: ["Decide"], operationId: "explainGet", summary: "Why did this token move? (latest brief)", description: "The latest investigated brief: what happened, likely causes with confidence, onchain evidence, market context, what to watch — every statement cites evidence ids." + paid("GET /v1/explain"), parameters: [tokenParam], responses: resp("brief", "Brief", "Brief") } },
      "/explain/{token}/{id}": { get: { tags: ["Decide"], operationId: "explainById", summary: "A specific past brief", parameters: [tokenParam, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: resp("brief", "Brief", "Brief") } },
      "/explain": { post: { tags: ["Decide"], operationId: "explain", summary: "Run a fresh investigation (~60 s)", description: "Gathers evidence, makes live onchain lookups and writes a new brief." + paid("POST /v1/explain"), requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { token: { type: "string" }, hours: { type: "number", default: 2, minimum: 1, maximum: 24 } }, required: ["token"] } } } }, responses: { 200: { description: "Brief", content: { "application/json": { schema: envelope("brief", "#/components/schemas/Brief") } } }, 400: err, 402: err, 429: err, 502: err } } },
      "/ask": { post: { tags: ["Decide"], operationId: "ask", summary: "Ask a question about a token, or check a claim", description: "A question gets a cited answer; a claim gets supported / contradicted / unknown with evidence." + paid("POST /v1/ask"), requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { token: { type: "string" }, question: { type: "string" }, claim: { type: "string" } }, required: ["token"] } } } }, responses: { 201: { description: "Answer", content: { "application/json": { schema: envelope("answer", "#/components/schemas/Answer") } } }, 400: err, 402: err, 404: err } } },
      "/monitor": {
        post: { tags: ["Watch"], operationId: "monitorCreate", summary: "Watch tokens and receive webhooks", description: "We POST to your webhook when a signal fires, a verdict changes or a new brief is written. Webhooks are signed (X-CoinGraph-Signature, HMAC-SHA256 with your secret).", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorRequest" } } } }, responses: { 201: { description: "Monitor", content: { "application/json": { schema: envelope("monitor", "#/components/schemas/Monitor") } } }, 400: err } },
        get: { tags: ["Watch"], operationId: "monitorList", summary: "List your monitors", parameters: [{ name: "X-Monitor-Secret", in: "header", required: true, schema: { type: "string" } }], responses: resp("monitor_list", "MonitorList", "Monitors") },
      },
      "/monitor/{id}": { delete: { tags: ["Watch"], operationId: "monitorDelete", summary: "Stop a monitor", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "X-Monitor-Secret", in: "header", required: true, schema: { type: "string" } }], responses: resp("monitor", "Monitor", "Monitor") } },
      "/record": { get: { tags: ["Trust"], operationId: "record", summary: "Our public scorecard", description: "Every evaluation, signal and brief issued, what the price did 1h/24h/7d later, and whether the call was right; calibration by kind and severity.", parameters: [sinceParam, { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["evaluation", "signal", "brief"] } }], responses: resp("record", "Record", "Record") } },
      "/record/{token}": { get: { tags: ["Trust"], operationId: "recordToken", summary: "The scorecard for one token", parameters: [tokenParam, sinceParam], responses: resp("record", "Record", "Record") } },
      "/verify/{id}": { get: { tags: ["Trust"], operationId: "verify", summary: "Proof of what you were told", description: "The canonical object, its sha256, the Chainlink attestation (pending until written) and the source calls behind it.", parameters: [{ name: "id", in: "path", required: true, description: "eval_…, ans_… or a brief number", schema: { type: "string" } }], responses: resp("proof", "Proof", "Proof") } },
    },
    components: {
      schemas: {
        Source: { type: "object", properties: { provider: { type: "string" }, endpoint: { type: "string" }, as_of: { type: ["string", "null"], format: "date-time" } } },
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
        TokenList: { type: "object", additionalProperties: true }, ServiceStatus: { type: "object", additionalProperties: true },
        State: { type: "object", description: "token + one key per section; each section has as_of and sources; unmeasured values are the string \"unassessed\".", additionalProperties: true },
        History: { type: "object", properties: { token: { type: "object" }, window: { type: "object" }, series: { type: "object" }, events: { type: "object" } } },
        MarketState: { type: "object", additionalProperties: true }, AddressProfile: { type: "object", additionalProperties: true },
        EvaluateRequest: { type: "object", properties: { token: { type: "string" }, size_usd: { type: "number", description: "Your intended order size in USD" }, policy: { type: "object", properties: { max_unlock_pct: { type: "number" }, min_depth_usd: { type: "number" }, allow_mint_authority: { type: "boolean" }, max_top10_holder_pct: { type: "number" }, max_funding_pct: { type: "number" }, max_exchange_inflow_usd: { type: "number" } } } }, required: ["token"] },
        Evaluation: { type: "object", properties: { verdict: { type: "string", enum: ["proceed", "caution", "avoid"] }, confidence: { type: "number" }, dimensions: { type: "object" }, reasons: { type: "array" }, size_check: { type: ["object", "null"] }, policy_check: { type: ["object", "null"] }, watch_next: { type: "array" }, hash: { type: "string" }, verify_url: { type: "string" } } },
        Brief: { type: "object", properties: { headline: { type: "string" }, direction: { type: "string" }, severity: { type: "integer" }, confidence: { type: "number" }, summary: { type: "string" }, what_happened: { type: "array" }, likely_causes: { type: "array" }, onchain: { type: "array" }, market_context: { type: "array" }, watch_next: { type: "array" }, caveats: { type: "array" }, evidence: { type: "array" }, verify_url: { type: "string" } } },
        Answer: { type: "object", additionalProperties: true },
        MonitorRequest: { type: "object", properties: { tokens: { type: "array", items: { type: "string" } }, webhook_url: { type: "string", format: "uri" }, conditions: { type: "object", properties: { kinds: { type: "array", items: { type: "string" } }, min_severity: { type: "integer", minimum: 1, maximum: 3 }, verdict_changes: { type: "boolean" }, new_briefs: { type: "boolean" } } } }, required: ["tokens", "webhook_url"] },
        Monitor: { type: "object", additionalProperties: true }, MonitorList: { type: "object", additionalProperties: true }, Record: { type: "object", additionalProperties: true }, Proof: { type: "object", additionalProperties: true },
      },
      securitySchemes: { x402: { type: "apiKey", in: "header", name: "X-Payment", description: "x402 payment proof (Cardano). Paid endpoints answer 402 with payment details." }, pass: { type: "http", scheme: "bearer", description: "Token Pass: 24h of Decide calls on one token." } },
    },
  };
}

export function buildLlmsTxt(): string {
  return `# CoinGraph

> The check before they act. Verified crypto market intelligence for AI agents: one call returns a sourced, timed answer about a token — never a trade.

Base URL: ${BASE_URL}/api/v1 · OpenAPI: ${BASE_URL}/api/v1/openapi.json · Reference: ${BASE_URL}/docs
Token ids are CoinGecko ids (bitcoin, ethereum, aave); symbols and contract addresses also work.
Every response: { object, id, as_of, data, sources }. Unmeasured values are "unassessed". No key needed to start (60 requests/min).

## Discover (free)
- GET /tokens — the 100 tracked tokens; ?q= to search 21,000+ coins
- GET /status — health, freshness, coverage, prices, payment address

## Understand
- GET /state/{token} — everything known right now; ?sections=market,liquidity,derivatives,onchain,supply,context,signals,brief
- GET /history/{token} — series and events; ?since=ISO
- GET /market — the whole market; ?sections=overview,sectors,breadth,sentiment,flows,chains,venues,rankings,events,pulse
- GET /inspect/{chain}/{address} — who owns an address (eth, bsc, btc, sol, ada)

## Decide
- GET /evaluate/{token} — verdict proceed/caution/avoid per dimension, with reasons and sources
- POST /evaluate {token, size_usd?, policy?} — same, scored against your order size and rules
- GET /explain/{token} — latest brief (why it moved), every claim cited
- POST /explain {token, hours?} — run a fresh investigation (~60s)
- POST /ask {token, question | claim} — cited answer, or supported/contradicted/unknown

## Watch
- POST /monitor {tokens[], webhook_url, conditions?} — signed webhooks when signals fire, verdicts change or briefs are written

## Trust
- GET /record[/{token}] — public scorecard: every call we made and whether it was right
- GET /verify/{id} — canonical object, sha256, Chainlink attestation, source provenance

## Payments
${PRICING_NOTES.summary} Paid endpoints answer 402 with x402 details; pay in ADA and retry with the X-Payment header.

CoinGraph never executes, custodies or advises. The caller decides.
`;
}
