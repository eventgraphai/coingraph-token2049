# CoinGraph: the check before AI agents act

AI agents move money in crypto. CoinGraph is the check they run first: fragmented market, exchange, on-chain, contract and news data in, one verified answer out. Every number is sourced and timed, every verdict comes with its reasons, and every answer carries a SHA-256 fingerprint you can verify.

Built for the **TOKEN2049 Origins Hackathon** (6–8 October 2026).

| | |
|---|---|
| Website | https://token2049.coingraph.ai |
| Try an agent | https://token2049.coingraph.ai/agents |
| Documentation | https://token2049.coingraph.ai/docs |
| REST API | `https://token2049.coingraph.ai/api/v1` · [OpenAPI](https://token2049.coingraph.ai/openapi.json) · [llms.txt](https://token2049.coingraph.ai/llms.txt) |
| MCP server | `https://token2049.coingraph.ai/mcp` |

## What it does

Ask “should I buy $5K of SOL right now?” and CoinGraph checks seven dimensions from live data — momentum, liquidity, leverage, on-chain flows, supply, contract and context — and answers **proceed**, **caution** or **avoid** with every reason and its source. Anything it cannot measure is returned as `"unassessed"`, never guessed.

Three ways in, one engine:

- **MCP server (22 tools, 3 prompts)** for Claude, Claude Code, Cursor and any MCP client: *“Is it safe to buy $5K of LINK? Use CoinGraph.”*
- **REST API (12 endpoints)** in five groups: discover, understand, decide, watch, trust.
- **Ten ready-made agents**, each doing a whole job in one call:

| Agent | Answers |
|---|---|
| Trade Gatekeeper | ALLOW / REDUCE (with a safe size) / BLOCK a trade |
| Wallet Guard | SAFE / WARN / STOP before signing a swap or send (sanctions, scam flags, address poisoning) |
| Due Diligence Analyst | A graded A–F memo on any token |
| Opportunity Scout | Movers that pass the full check, with invalidation levels |
| Leverage Radar | Crowding score for futures markets |
| Whale Watch | Accumulating / distributing / neutral |
| Portfolio Checkup | A health grade for a wallet |
| Treasury Steward | A treasury's rules checked asset by asset |
| Alert Watchtower | Alerts on your tokens, each explained, with signed webhooks |
| Daily Market Brief | The market on one page |

Every check, answer, brief and agent run is stored exactly as issued and can be verified at `/proof/{id}` or `GET /v1/verify/{id}`. Every call is graded in public against what the price did next (`GET /v1/record`).

## Partner technology

| Partner | How CoinGraph uses it | Status |
|---|---|---|
| **NOWNodes** | Full nodes for Ethereum, BNB Chain, Bitcoin, Solana and Cardano: exchange flows and reserves, large transfers, holder concentration, fees, live address lookups | Live |
| **Cardano · Masumi · Sokosumi** | CoinGraph Crypto Analyst is a Masumi Coworker on Sokosumi: hired per Task, paid 1 test USDM into Masumi escrow on Cardano Preprod, result hash on chain, payout collected and verified on chain (`coworker/`) | Live |
| **x402 on Cardano** | Pay-per-call for the REST API and MCP | Next |
| **Chainlink CRE** | Attests each answer's fingerprint so anyone can confirm what was said and when | In progress |

Other sources: CoinGecko (market data), exchanges via CCXT (order books, funding, open interest, liquidations), GoPlus (contract and address security), DefiLlama (TVL), ParaSwap / KyberSwap / Jupiter (swap quotes), OFAC sanctions lists, crypto news feeds, Fear & Greed, and Claude for cited briefs.

## Architecture

```
 CoinGecko · CCXT exchanges · NOWNodes (5 chains) · GoPlus · DefiLlama · DEX routers · OFAC · news
                                        │
                     worker/ (Railway)  ▼  scheduled ingestion, retention, health tracking
                                 PostgreSQL (Supabase, RLS on every table)
                                        │
          signal engine (11 rules) → investigations → Claude briefs (every claim cites evidence)
                                        │
             app/ (Next.js on Railway): REST API · MCP server · agents · website · docs
                                        │
                  proofs: canonical JSON → SHA-256 → /verify → Chainlink attestation
```

| Path | Contents |
|---|---|
| `app/` | Website, docs (`/docs`), REST routes (`/api/v1`), MCP endpoint (`/mcp`) |
| `lib/api/` | Endpoint logic: state, history, market, inspect, evaluate, explain, ask, monitor, record, verify |
| `lib/agents/` | The ten agents and their registry |
| `lib/mcp/` | MCP tools and prompts |
| `lib/nownodes/`, `lib/security/`, `lib/external/`, `lib/coingecko/`, `lib/ccxt/` | Data ingestion |
| `lib/signals/`, `lib/investigations/` | Signal engine and cited briefs |
| `worker/` | The ingestion scheduler |
| `db/migrations/` | Database schema |
| `scripts/` | Test suites (`api-test.py`, `mcp-test.py`), agent CLI, docs example capture |

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in your own keys; never commit .env.local
npm run dev                  # website, API and MCP on http://localhost:3000
npm run worker               # data ingestion (optional locally)
```

Tests against any deployment:

```bash
python3 scripts/api-test.py http://localhost:3000
python3 scripts/mcp-test.py http://localhost:3000
```

## Security

- No secrets in the repository; `.env.local` and `cre/.env` are git-ignored.
- Row-level security on every database table and no public grants; the API is the only way in.
- Request size limits, per-caller rate limits, and webhook URLs restricted to public hosts (resolved and re-checked before every delivery, redirects not followed).
- Webhooks are signed with HMAC-SHA256; monitor secrets are shown once.
- CoinGraph never trades, holds funds or gives financial advice. The caller decides.

## Eligibility

All application code in this repository was written during the TOKEN2049 Origins Hackathon (6–8 October 2026). The visual design system (colour tokens, fonts and the CoinGraph logo) is carried over from the CoinGraph brand; no product code was reused. Public libraries, frameworks and APIs are used as permitted by the rules. See [docs/BRIEF.md](docs/BRIEF.md) for the original build brief.

Contact: Ajay Prashanth · ajay@coingraph.ai
