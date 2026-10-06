# CoinGraph API v1

**Base URL:** `https://token2049.coingraph.ai/api/v1`
**Format:** JSON over HTTPS. No key needed to start.
**Token ids:** CoinGecko ids (`bitcoin`, `ethereum`, `aave`). Symbols (`BTC`) and contract addresses also work.

**Every response** uses the same envelope:

```json
{
  "object": "state",
  "id": "st_8f1c2a…",
  "as_of": "2026-10-06T15:40:12Z",
  "data": { "…": "…" },
  "sources": [ { "provider": "coingecko", "endpoint": "/coins/markets", "as_of": "2026-10-06T15:40:01Z" } ]
}
```

`as_of` is when the data was true. `sources` lists where it came from. Anything we cannot measure is returned as `"unassessed"`, never guessed.

**Errors:** `{ "error": { "code": "token_not_found", "message": "…" } }` with HTTP `400`, `402`, `404`, `429` or `500`.

---

## 1. Discover

Find what CoinGraph covers and whether it is healthy. Free, no key.

### `GET /v1/tokens`

List the 100 tokens we track.

| Input | Where | Required | Description |
|---|---|---|---|
| `q` | query | no | Search by name, symbol or contract address across 21,000+ coins; results say whether each one is tracked. |

**Returns** `TokenList`: for each token `id`, `symbol`, `name`, `rank`, `chains` (contract address per chain), `price_usd`, `change_1h`, `change_24h`, `categories`, `open_signals`, `latest_headline`, `tracked_since`.

Example: `GET /v1/tokens?q=aave`

### `GET /v1/status`

Is CoinGraph healthy right now?

**Returns** `ServiceStatus`: `pipeline` (ok / degraded), `feeds` (each source with last update and status), `freshness` (newest data per category), `coverage` (tokens, venues, chains), `pricing` (current phase and prices), `payment` (Cardano address, network).

---

## 2. Understand

Everything CoinGraph knows, as data. Free during the hackathon and the design-partner phase.

### `GET /v1/state/{token}`

Everything we know about a token right now, in one object.

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | path | yes | Token id, symbol or contract address. |
| `sections` | query | no | Comma list to return only some parts: `identity, market, liquidity, derivatives, onchain, supply, context, signals, brief`. Default: all. |

**Returns** `State` with these sections, each carrying its own `sources` and `as_of`:

| Section | Contents |
|---|---|
| `identity` | name, symbol, chains and contracts, categories, links, description, where it trades (venues, primary venue) |
| `market` | price, market cap, FDV, 24h volume, changes 15m/1h/4h/24h/7d/30d/1y, 24h high/low, ATH/ATL and distance, rank, 24h volatility, beta to BTC |
| `liquidity` | order-book depth within 2% (bid/ask) and spread per venue, cost to move the price ±2% across 100+ exchanges, DEX pools (liquidity, buys/sells), venue count, trust-weighted volume, price dispersion across venues |
| `derivatives` | open interest per venue and total with 1h/4h/24h change, funding per venue (current, next, annualised), long/short ratios (all accounts, top accounts, top positions), taker buy/sell, liquidations 1h/24h by side, basis, leverage ratio (OI / market cap) |
| `onchain` | exchange inflow/outflow/net (15m/1h/24h/7d), transfers and volume, unique senders/receivers, mint/burn, large transfers (last 24h, tagged with exchange names), exchange reserves by exchange with 24h/7d change, holder concentration (top 10/20 %), network fees |
| `supply` | circulating/total/max, % issued, FDV/market-cap ratio, exchange-held share, top-holder share, public-treasury holdings; `unlocks: "unassessed"` |
| `context` | news (last 24h), protocol TVL (1d/7d change), developer activity (commits, PRs, stars), community (followers, watchlists), CoinGecko sentiment, trending rank, Fear & Greed |
| `signals` | open signals: kind, direction, severity, when, details |
| `brief` | latest brief: id, headline, direction, severity, confidence, when (full text via `/explain`) |

Example: `GET /v1/state/aave?sections=market,liquidity`

### `GET /v1/history/{token}`

What happened to a token over time: charts and events.

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | path | yes | Token id. |
| `since` | query | no | ISO time. Default: 24 h for events, 14 days for series. |
| `series` | query | no | Comma list to limit which series are returned. Default: all. |

**Returns** `History`:

| Key | Contents |
|---|---|
| `series` | `price` (5-min for 14 days, hourly for 30 days), `market_cap`, `volume`, `candles` (1-min, 24 h, primary venue), `open_interest`, `funding`, `long_short`, `exchange_net_flow` (15-min), `reserves` (hourly), `tvl` (6-hourly) |
| `events` | `transfers` (large, with from/to, exchange tags, tx hash), `liquidations`, `signals`, `headlines`, `briefs` — each with a timestamp |

Example: `GET /v1/history/chainlink?since=2026-10-06T00:00:00Z`

### `GET /v1/market`

The whole market at a glance.

| Input | Where | Required | Description |
|---|---|---|---|
| `sections` | query | no | `overview, sectors, breadth, sentiment, flows, chains, venues, rankings, events, pulse`. Default: all. |

**Returns** `MarketState`:

| Section | Contents |
|---|---|
| `overview` | total market cap and volume, 24h change, BTC/ETH dominance, active coins |
| `sectors` | market cap and 24h change per category, top coins per sector (771 categories) |
| `breadth` | % of the top 100 up/down over 1h/24h, % with rising open interest |
| `sentiment` | Fear & Greed today and 30-day history, trending searches |
| `flows` | stablecoins moving to/from exchanges (1h/24h), total exchange net flow, biggest inflows/outflows |
| `chains` | Ethereum/BSC fees and block fullness, Bitcoin mempool and fee estimates, node status |
| `venues` | exchange status (maintenance, outages) |
| `rankings` | top gainers/losers (1h/24h), volume spikes, OI change, funding extremes, exchange inflow/outflow, whale activity, news count, risk flags |
| `events` | universe-wide last 24h: whale transfers, liquidation clusters, signals, headlines |
| `pulse` | the hourly written market brief (what is moving and why, cited) |

Example: `GET /v1/market?sections=overview,rankings`

### `GET /v1/inspect/{chain}/{address}`

Who owns an address?

| Input | Where | Required | Description |
|---|---|---|---|
| `chain` | path | yes | One of `eth`, `bsc`, `btc`, `sol`, `ada`. |
| `address` | path | yes | The address to look up. |

**Returns** `AddressProfile`: `label` (exchange name, contract, burn, or "unlabelled"), `type` (exchange / contract / whale / new wallet / regular), `balances` (native and tracked tokens, with USD), `tx_count`, `first_seen`, `recent_large_moves`, `balance_history` (where available). Fetched live from the chain through NOWNodes.

Example: `GET /v1/inspect/eth/0x28c6c06298d514db089934071355e5743bf21d60`

---

## 3. Decide

Ask CoinGraph to think. These calls create new objects with ids that go into the public record.

### `GET /v1/evaluate/{token}` · `POST /v1/evaluate`

Should you act on this token right now?

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | path (GET) / body (POST) | yes | Token id. |
| `size_usd` | body (POST) | no | Your intended order size in USD. |
| `policy` | body (POST) | no | Your rules: `max_unlock_pct`, `min_depth_usd`, `allow_mint_authority`, `max_top10_holder_pct`, `max_funding_pct`, `max_exchange_inflow_usd`. |

GET is the standard check, independent of order size. POST scores the check against your size and rules.

**Returns** `Evaluation`:

| Key | Contents |
|---|---|
| `verdict` | `proceed` / `caution` / `avoid` |
| `confidence` | 0–1 |
| `dimensions` | `momentum, liquidity, leverage, onchain, supply, context, contract` — each `ok` / `caution` / `avoid` / `unassessed`, with reasons and sources |
| `size_check` (POST) | your order vs 2% depth and vs daily volume, estimated price impact |
| `policy_check` (POST) | pass/fail per rule |
| `reasons` | the 3–5 statements that drive the verdict, each with sources |
| `watch_next` | what would change the verdict |
| `id`, `as_of`, `verify_url` | for the public record and proof |

Example: `POST /v1/evaluate` with `{ "token": "ethereum", "size_usd": 5000 }`

### `GET /v1/explain/{token}` · `POST /v1/explain` · `GET /v1/explain/{token}/{id}`

Why did this token move?

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | path (GET) / body (POST) | yes | Token id. |
| `id` | path | no | A specific past brief. |
| `hours` | body (POST) | no | The window to investigate. Default 2. |

GET returns the latest brief (cached). POST runs a fresh investigation (about 60 seconds): gathers the evidence, makes live onchain lookups, writes the brief.

**Returns** `Brief`: `headline`, `direction`, `severity`, `confidence`, `summary`, `what_happened[]`, `likely_causes[]` (with confidence), `onchain[]`, `market_context[]`, `watch_next[]`, `caveats[]`, `evidence[]` (each item: id, source, summary, data). Every statement cites evidence ids. Plus `id`, `as_of`, `verify_url`.

Example: `POST /v1/explain` with `{ "token": "aave" }`

### `POST /v1/ask`

Ask a question about a token, or check whether a claim is true.

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | body | yes | Token id. |
| `question` | body | one of the two | A free-text question. |
| `claim` | body | one of the two | A statement to test. |

**Returns** `Answer`. For a question: `answer` (plain text), `key_points[]` with sources, `confidence`. For a claim: `verdict` (`supported` / `contradicted` / `unknown`), `reasoning[]` with sources, `confidence`. Both include `evidence[]`, `id`, `as_of`, `verify_url`.

Example: `POST /v1/ask` with `{ "token": "ondo-finance", "claim": "ONDO is up because whales are buying on Binance" }`

---

## 4. Watch

Get told when something changes.

### `POST /v1/monitor` · `GET /v1/monitor` · `DELETE /v1/monitor/{id}`

Watch tokens and receive webhooks.

| Input | Where | Required | Description |
|---|---|---|---|
| `tokens` | body | yes | List of token ids. |
| `webhook_url` | body | yes | HTTPS URL we POST to. |
| `conditions` | body | no | `kinds[]` (signal kinds to include), `min_severity` (1–3, default 2), `verdict_changes` (true/false), `new_briefs` (true/false). |

**Returns** `Monitor`: `id`, `secret` (shown once; webhooks are signed with it), `tokens`, `conditions`, `created_at`.

**Webhook payload:** `{ "monitor_id", "kind": "signal" | "brief" | "verdict_change", "token", "object": { … }, "as_of" }` with header `X-CoinGraph-Signature` (HMAC-SHA256 of the body using the secret).

`GET /v1/monitor` lists your monitors (authenticated by the secret). `DELETE /v1/monitor/{id}` removes one.

---

## 5. Trust

Check CoinGraph's record and prove what you were told.

### `GET /v1/record` · `GET /v1/record/{token}`

Our public scorecard.

| Input | Where | Required | Description |
|---|---|---|---|
| `token` | path | no | Limit to one token. |
| `since` | query | no | ISO time. |
| `kind` | query | no | `evaluation`, `signal` or `brief`. |

**Returns** `Record`: `ledger[]` — every evaluation, signal and brief issued (what it said, when, what was known) with the price 1h/24h/7d later and whether the call was right; `calibration` — hit-rate by kind and severity with sample sizes.

### `GET /v1/verify/{id}`

Proof of what you were told.

| Input | Where | Required | Description |
|---|---|---|---|
| `id` | path | yes | Id of an evaluation (`eval_…`), answer (`ans_…`), agent run (`run_…`) or brief number. |

**Returns** `Proof`: the canonical object, `sha256`, `issued_at`, `attestation` (Chainlink CRE: workflow id, timestamp, transaction/receipt — `pending` until attested), `provenance[]` (every source call behind the object: provider, endpoint, time, latency).

---

## Docs and agents

| Resource | Description |
|---|---|
| `GET /v1/openapi.json` | OpenAPI 3.1 specification generated from this document. |
| `GET /llms.txt` | Short agent-readable guide: what CoinGraph is, the 12 endpoints, how to pay. |
| MCP server | The same 12 endpoints as tools, plus one `run_…` tool per agent and three prompts. See [MCP.md](MCP.md). |

## Agents

Ten ready-made agents built on the endpoints above. Full list, inputs and verdicts in [AGENTS.md](AGENTS.md).

| Endpoint | Description |
|---|---|
| `GET /v1/agents` | Every agent with its input schema, verdicts, price and an example input. |
| `GET /v1/agents/{id}` | One agent's card. |
| `POST /v1/agents/{id}` | Run the agent. Returns `agent_run`: `verdict`, `summary`, `result`, `reasons`, `run_id`, `verify_url`. Invalid input answers `400 invalid_input`. |

## Payments (to be finalised)

Free endpoints need nothing. Paid endpoints answer `402 Payment Required` with the x402 payment details (amount in ADA, our address, network). The agent pays on Cardano and retries with the `X-Payment` header. A **Token Pass** (`POST /v1/pass`) buys unlimited Decide calls on one token for 24 hours and is sent as `Authorization: Bearer <pass>`. Which endpoints are paid, and the prices, are published at `/v1/status` and set in one configuration file.

## Limits

Free use: 60 requests per minute per IP. `POST /v1/explain` and `POST /v1/ask` take 30–90 seconds and are limited to 20 per hour overall during the hackathon.
