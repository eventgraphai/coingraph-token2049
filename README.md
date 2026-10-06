# CoinGraph — TOKEN2049 Origins Hackathon

Verifiable crypto signals for AI agents.

CoinGraph monitors the Top 100 crypto assets, investigates unusual activity onchain,
correlates the evidence with deterministic signal logic, and returns a structured,
verified intelligence object that an AI agent can discover, pay for and act on.

**Hero workflow:** Discover → Pay → Investigate → Verify → Explain

> Data providers tell agents what happened. CoinGraph tells them what matters.

## How it fits together

| Layer | Role |
|---|---|
| CoinGecko | Market context: Top-100 universe, price, volume, baselines |
| NOWNodes | Direct onchain evidence: transfers, large transactions, wallet activity |
| CoinGraph signal engine | Anomaly detection, evidence correlation, confidence scoring |
| LLM | Explains the structured evidence; never invents it |
| Chainlink CRE | Verifies and orchestrates the investigation workflow |
| x402 / agent payments | Agents buy deep investigations per request |
| MCP | Exposes the same API to Claude, Cursor and other agents |
| Web UI | A thin window into what the agent sees |

API first, MCP second, UI third. One polished end-to-end investigation beats ten
half-working features.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Open http://localhost:3000.

## Eligibility

All application code in this repository was written during the TOKEN2049 Origins
Hackathon (6–8 October 2026). The visual design system (colour tokens, fonts and the
CoinGraph logo) is carried over from the CoinGraph brand; no product code was reused.
Public libraries, frameworks and APIs are used as permitted by the rules.

See [docs/BRIEF.md](docs/BRIEF.md) for the full build brief and scope.
