# CoinGraph MCP server

CoinGraph is available as a remote MCP server, so Claude, Cursor and any MCP-compatible agent can use it as a set of tools.

**URL:** `https://token2049.coingraph.ai/mcp`
**Transport:** Streamable HTTP (stateless). No key needed to start.

## Connect

**Claude (claude.ai / Claude Desktop):** Settings → Connectors → Add custom connector → name `CoinGraph`, URL `https://token2049.coingraph.ai/mcp`.

**Claude Code:**

```bash
claude mcp add --transport http coingraph https://token2049.coingraph.ai/mcp
```

**Cursor** (`~/.cursor/mcp.json`) and other clients that take a JSON config:

```json
{
  "mcpServers": {
    "coingraph": { "url": "https://token2049.coingraph.ai/mcp" }
  }
}
```

**Clients that only support local (stdio) servers:**

```json
{
  "mcpServers": {
    "coingraph": { "command": "npx", "args": ["-y", "mcp-remote", "https://token2049.coingraph.ai/mcp"] }
  }
}
```

## Tools

| Tool | What it does | Same as REST |
|---|---|---|
| `search_tokens` | Find a token: list the 100 tracked tokens, or search 21,000+ by name, symbol or contract address | `GET /v1/tokens` |
| `get_token_snapshot` | Everything known about a token right now: market, liquidity, futures, onchain flows, supply, news, signals, latest brief — each part with source and age | `GET /v1/state/{token}` |
| `get_token_timeline` | What happened over time: charts (price, candles, open interest, funding, flows, reserves, TVL) and events (whale transfers, liquidations, signals, headlines, briefs) | `GET /v1/history/{token}` |
| `check_token` | The check before acting: proceed / caution / avoid across seven dimensions, with sourced reasons; optional order size and rules | `GET /v1/evaluate/{token}`, `POST /v1/evaluate` |
| `get_token_brief` | Why the token moved: the cited brief; `fresh: true` runs a new investigation (~1 minute) | `GET /v1/explain/{token}`, `POST /v1/explain` |
| `ask_about_token` | A question gets a cited answer; a claim gets supported / contradicted / unknown | `POST /v1/ask` |
| `watch_tokens` | Signed webhook messages when signals fire or new briefs are written | `POST /v1/monitor` |
| `get_market_overview` | The whole market: totals, sectors, breadth, Fear & Greed, flows, fees, rankings, events | `GET /v1/market` |
| `lookup_address` | Who is behind an address (Ethereum, BNB Chain, Bitcoin, Solana, Cardano), read live from the chain | `GET /v1/inspect/{chain}/{address}` |
| `get_track_record` | Public scorecard: every call CoinGraph made and whether it was right | `GET /v1/record` |
| `get_proof` | The original object, its SHA-256, the Chainlink attestation status and the source calls behind it | `GET /v1/verify/{id}` |
| `get_service_status` | Health, data freshness, coverage, prices, payment details | `GET /v1/status` |

Tool results are the same JSON the REST API returns: `{ object, id, as_of, data, sources }`.

**Hints for clients:** reads (`search_tokens`, `get_token_snapshot`, `get_token_timeline`, `get_market_overview`, `lookup_address`, `get_track_record`, `get_proof`, `get_service_status`) are marked read-only. `check_token`, `get_token_brief`, `ask_about_token` and `watch_tokens` create a stored object (a check, a brief, an answer or a watch).

**Limits:** the same as the API — 60 requests per minute per caller; fresh briefs and questions take 20–60 seconds and are limited during the hackathon.

CoinGraph never trades, holds funds or gives financial advice. The caller decides.
