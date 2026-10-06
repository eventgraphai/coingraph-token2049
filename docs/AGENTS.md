# CoinGraph agents

Ten ready-made agents built on the CoinGraph data. Each one does a whole job in one call and returns the same shape:

```json
{
  "run_id": "run_…",
  "agent": "trade-gatekeeper",
  "verdict": "ALLOW",
  "summary": "One or two plain sentences.",
  "result": { "…": "the structured answer" },
  "reasons": [{ "text": "…", "source": "provider:endpoint" }],
  "warnings": ["…"],
  "hash": "sha256 of the stored run",
  "verify_url": "https://token2049.coingraph.ai/api/v1/verify/run_…"
}
```

Every run is stored and hashed. `GET /v1/verify/{run_id}` returns the exact object, its SHA-256 and the source calls behind it.

## How to call them

| Channel | How |
|---|---|
| REST | `POST /api/v1/agents/{id}` with a JSON body. `GET /api/v1/agents` lists every agent with its input schema and an example. |
| MCP | One tool per agent: `run_trade_gatekeeper`, `run_wallet_guard`, and so on. |
| MCP prompts | `pre_trade_check`, `wallet_safety_check`, `token_due_diligence` (slash commands in clients that support prompts). |
| CLI | `npx tsx scripts/agent.ts <id> '<json>'` or `npx tsx scripts/agent.ts list`. |

## The agents

| Agent | What it does | Verdicts | Example input | Tier |
|---|---|---|---|---|
| **Trade Gatekeeper** `trade-gatekeeper` | The check every trade passes before it is placed. Compares your size with exchange order books and the best on-chain route, then applies contract, supply, leverage and flow checks and your own rules. | ALLOW / REDUCE / BLOCK | `{"token":"uniswap","size_usd":250000,"side":"buy"}` | Premium |
| **Wallet Guard** `wallet-guard` | Checks a swap or a send before you sign it: token contract risks, price impact, and the recipient (OFAC sanctions, scam flags, look-alike address poisoning, brand-new wallets). | SAFE / WARN / STOP | `{"token":"pepe","amount_usd":5000,"to_address":"0x28c6…1d60","chain":"eth"}` | Premium |
| **Due Diligence Analyst** `due-diligence-analyst` | A full due-diligence memo on any token in one run: six graded sections, red flags, strengths and a short written summary. | A–F | `{"token":"morpho"}` | Pro |
| **Opportunity Scout** `opportunity-scout` | Finds what's moving, runs the full check on each, drops anything rated avoid, and gives the level that would prove the idea wrong. | SETUPS_FOUND / NOTHING_CLEAN | `{"limit":5}` | Pro |
| **Leverage Radar** `leverage-radar` | Scores every futures market 0–100 for crowding: funding against its own history, open-interest growth, top-trader positioning, open interest versus market cap, liquidations. | CROWDED / ELEVATED / BALANCED | `{"top":5}` | Premium |
| **Whale Watch** `whale-watch` | Shows what the big wallets are doing: exchange net flows against their normal range, exchange reserves, large transfers with live wallet profiles. | ACCUMULATING / DISTRIBUTING / NEUTRAL / NO_DATA | `{"token":"aave"}` | Premium |
| **Portfolio Checkup** `portfolio-checkup` | A health check for everything in a wallet: concentration, how easy each position is to exit, contract risks, and a grade. | A–F | `{"chain":"eth","address":"0x9fc3…10c8"}` | Pro |
| **Treasury Steward** `treasury-steward` | Enforces a treasury's rules (depth, exit slippage, mint authority, share of market cap) asset by asset, with proof. | COMPLIANT / BREACH / INCOMPLETE | see `GET /api/v1/agents/treasury-steward` | Pro |
| **Alert Watchtower** `alert-watchtower` | Watches your tokens and explains every alert with its brief; optional signed webhook. | ACTIVE / QUIET | `{"tokens":["bitcoin","ethereum","aave"],"min_severity":2}` | Premium |
| **Daily Market Brief** `daily-market-brief` | The whole market on one readable page: risk mood, graded calls, crowded trades, movers, headlines and your holdings. | RISK_ON / RISK_OFF / NEUTRAL | `{"holdings":["bitcoin","ethereum","aave"]}` | Premium |

## Pricing

Agents are paid per run with x402 on Cardano. During the hackathon this runs on the preprod testnet.

| Tier | Testnet price | Planned mainnet price |
|---|---|---|
| Premium | 5 tADA | $0.05 |
| Pro | 10 tADA | $0.25 |

Trade Gatekeeper, Wallet Guard and Due Diligence Analyst are also listed on Masumi and use Masumi escrow. Design partners can use an API key instead of paying per call.

CoinGraph agents never trade, hold funds or give financial advice. They return a verdict with its evidence; the caller decides.
