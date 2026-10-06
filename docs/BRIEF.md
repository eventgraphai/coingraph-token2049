# CoinGraph — TOKEN2049 Origins Build Brief

COINGRAPH

TOKEN2049 Origins Hackathon Build Brief

Agents-first crypto decision infrastructure

Core thesisCoinGraph turns fragmented market and onchain data into actionable, evidence-backed signals that AI agents can discover, purchase, verify and use autonomously.

Primary user

AI agents

Human experience

Thin visualization layer — a window into what the agent sees

Core product

CoinGraph Intelligence API

Agent interface

MCP

Hero workflow

Discover → Pay → Investigate → Verify → Explain

Scope rule: one polished end-to-end investigation beats ten half-working features.


## 1. Product Definition

CoinGraph is the decision layer for crypto. It monitors the market for unusual activity, investigates the relevant onchain evidence, converts that evidence into structured signals, and returns a verifiable explanation that an AI agent can reason over.

Hackathon one-liner

PitchWe’re building CoinGraph — decision infrastructure for crypto. We turn fragmented market and onchain data into verifiable signals that AI agents can understand and act on.

What CoinGraph is NOT

Not another crypto dashboard.

Not a generic AI chatbot over CoinGecko data.

Not a raw RPC or blockchain indexing provider.

Not an autonomous trading bot.

Not a replacement for CoinGecko, NOWNodes or other data providers.

What CoinGraph IS

A signal and reasoning layer above crypto data providers.

An API that returns structured, evidence-backed intelligence.

An MCP interface that makes the intelligence native to AI agents.

A pay-per-intelligence service that agents can purchase on demand.

A verifiable investigation workflow rather than an unsupported LLM answer.


## 2. Problem

Crypto has abundant data but poor synthesis: price, volume, transfers, wallets, token events and protocol activity live across different systems.

Raw APIs tell an agent what happened, but not what matters or how multiple observations relate.

LLMs can summarize data, but without evidence provenance they can overstate causality or invent explanations.

Autonomous agents need machine-readable intelligence and a simple way to buy it per request, not only human-oriented dashboards and subscriptions.

When something moves quickly, both humans and agents lose time assembling context manually.


## 3. Solution

Continuously monitor a focused token universe for market anomalies.

Trigger a deep investigation only when an anomaly is detected or an agent explicitly requests one.

Pull market context and onchain evidence from the appropriate providers.

Run CoinGraph’s deterministic signal logic before involving an LLM.

Use the LLM to explain structured evidence — not to invent the evidence.

Verify/orchestrate the workflow with Chainlink CRE.

Return a structured intelligence object, human-readable explanation and evidence receipt.

Allow the requesting agent to pay for premium investigations through the hackathon payment flow.


## 4. Product Interfaces: API First, MCP Second, UI Third

Layer

Purpose

Priority

Hackathon deliverable

CoinGraph API

Actual product and intelligence engine

P0

Discovery + investigation + receipt endpoints

MCP

Native interface for Claude/Cursor/agents

P0

3–5 tools backed by the same API

Human UI

Makes the workflow obvious to judges

P1

One investigation screen; not a separate consumer app

Product principleCoinGraph is built for agents. The human interface is only a window into what the agent sees.

Recommended human UI

One prompt/input: “Why is AAVE moving?” or “Find unusual activity.”

Live investigation timeline showing each stage.

Market evidence card.

Onchain evidence card.

CoinGraph signal + explanation.

Chainlink verification state.

Intelligence receipt.

Small developer panel showing the equivalent MCP/API call.

Do NOT build

Full conversational history or ChatGPT clone.

Portfolio management.

Trading terminal.

Watchlists and account system.

Complex charting suite.

Separate human and agent backends.


## 5. Hero Feature: Explain This Move

Example question: “Why is AAVE moving?”

1. CoinGecko → confirm price/volume anomaly2. CoinGraph → anomaly score crosses threshold3. NOWNodes → inspect relevant onchain activity4. Optional structured data adapter → enrich wallet/holder history5. CoinGraph Signal Engine → correlate evidence6. LLM → explain only the structured evidence7. Chainlink CRE → verify/orchestrate the workflow8. CoinGraph → return result + evidence receipt

Final answer exampleAAVE is showing unusually strong large-wallet accumulation alongside elevated trading volume and net exchange outflows. CoinGraph ranks whale accumulation as the strongest observed signal. Evidence confidence: 87%. Workflow verified.


## 6. Role of Each Technology

CoinGecko — Market Context

Top-100 universe and ranking

Price and percentage change

Volume and market cap

Historical market context

Primary lightweight monitoring input

Simple meaning: Tells CoinGraph what the market is doing.

NOWNodes — Direct Onchain Evidence

RPC/blockchain reads

Transfers and contract events

Large transaction inspection

Wallet activity

Direct chain evidence for investigations

Simple meaning: Gives CoinGraph eyes on the blockchain.

CoinGraph — Signal + Decision Layer

Anomaly detection

Evidence normalization

Signal correlation

Confidence scoring

Reasoning and explanation

Machine-readable intelligence output

Simple meaning: Figures out what the evidence means.

Chainlink CRE — Verification + Orchestration

Defined investigation workflow

Checks required evidence steps

Coordinates verification logic

Produces a verifiable workflow result/receipt

Simple meaning: Makes the intelligence workflow reproducible and trustworthy.

x402 / Agent Payment Flow — Commerce

Agent requests premium intelligence

Payment requirement returned

Agent pays programmatically

Investigation is unlocked

Result returned without human checkout

Simple meaning: Lets agents buy intelligence on demand.

MCP — Agent Interface

Expose CoinGraph tools to AI agents

Keep business logic in the API

Return structured outputs that agents can reason over

Simple meaning: Makes CoinGraph callable by agents.

Optional: GoldRush

Use only if it saves meaningful engineering time. GoldRush can provide structured wallet, transfer, holder and cross-chain history. Keep its role separate from NOWNodes:

GoldRush = structured/historical onchain data enrichment.

NOWNodes = direct/live chain access and hackathon sponsor integration.

CoinGraph = the proprietary signal, evidence and reasoning layer above both.

Do not make GoldRush a mandatory dependency for the main demo unless access is already working.


## 7. Token Coverage and Data Collection

Hackathon scopeMonitor the Top 100 crypto assets. Deeply investigate only the assets that trigger an anomaly or are explicitly requested.

Why Top 100

Large enough to demonstrate broad discovery.

Small enough to monitor cheaply and reliably.

Better signal quality and data availability than long-tail assets.

Lets the team focus on depth of investigation rather than claiming shallow coverage of 10,000 tokens.

Recommended fetch strategy

Source

When

Frequency

Store?

CoinGecko market batch

Continuous monitoring

Every 2–5 min; target 3 min

Yes — snapshots

NOWNodes

Anomaly or explicit investigation

On demand / event-driven

Yes — relevant evidence only

Chainlink CRE

After evidence package is ready

Per investigation

Store verification result

LLM

After deterministic signals exist

Per investigation

Store final explanation + model metadata

Important

Do not call NOWNodes continuously for all 100 assets.

Do not call CoinGecko token-by-token if a batch endpoint can provide the required market data.

Preload enough historical market data to calculate baselines before the live demo.

Have 3–5 demo assets with excellent end-to-end coverage even if the monitor watches 100.

Two-tier architecture

TOP 100 TOKENS      ↓LIGHTWEIGHT MONITORINGCoinGecko → price / volume / change / baseline      ↓ANOMALY?   no → keep monitoring   yes      ↓DEEP INVESTIGATIONNOWNodes + optional structured enrichment      ↓CoinGraph signals      ↓Chainlink CRE verification      ↓Verified intelligence


## 8. Database and Core Data Model

Use PostgreSQL. Do not add a graph database for the hackathon. JSONB is enough for flexible evidence.

Table

Purpose

Important fields

tokens

Supported asset registry

symbol, coingecko_id, chain, contract_address, rank

market_snapshots

Historical monitoring

token_id, price, volume, market_cap, timestamp

signals

Deterministic anomalies

token_id, type, score, value, baseline, detected_at

investigations

Investigation lifecycle

token_id, trigger, status, confidence, summary

evidence

Provenance-backed observations

investigation_id, source, type, JSONB data, timestamp

intelligence_receipts

Final proof/record

investigation_id, payment, CRE status, result_hash

Evidence object

{  "type": "large_transfer",  "asset": "AAVE",  "value_usd": 2400000,  "source": "nownodes",  "chain": "ethereum",  "tx_hash": "0x...",  "observed_at": "..."}

Optional Redis

Only if the team already knows it. Use for latest-price cache, rate limits, active jobs and temporary sessions. PostgreSQL alone is acceptable for the hackathon.


## 9. CoinGraph Signal Engine

The LLM must not be the signal engine. CoinGraph should calculate structured signals first using rules/statistical baselines.

Price velocity anomaly.

Volume anomaly / volume ratio / z-score.

Large-transfer anomaly.

Whale net-flow anomaly.

Exchange-related flow change where labels are available.

Cross-signal correlation.

Example:if abs(price_change_15m) > thresholdand volume_zscore > 2.5:    trigger_investigation()Then:structured evidence → LLM explanation

Confidence score

Confidence should represent confidence in the evidence supporting the detected signal — not confidence that price will rise or fall.

Market anomaly strength.

Volume anomaly strength.

Onchain evidence strength.

Number of independent supporting signals.

Data freshness/completeness.

Verification completion.


## 10. API, MCP and Payment Design

Suggested API

POST /v1/discoverPOST /v1/investigatePOST /v1/explain-movePOST /v1/wallet-xray        # optionalGET  /v1/intelligence/:idGET  /v1/intelligence/:id/receipt

Suggested MCP tools

coingraph_discover_signals()coingraph_investigate_token(token)coingraph_explain_move(token)coingraph_verify_intelligence(signal_id)coingraph_analyze_wallet(address)   # optional

Payment placement

Agent → POST /investigate/AAVE           ↓     Payment required           ↓     Agent pays           ↓  Payment verified           ↓ Deep investigation           ↓ Verified intelligence

Recommended pricing demo: keep discovery free or very cheap; gate deep investigation / explain / wallet X-ray behind the agent payment flow.

Machine-readable response

{  "asset": "AAVE",  "signal": "unusual_whale_accumulation",  "summary": "Large-wallet accumulation increased alongside elevated volume.",  "confidence": 0.87,  "market": {    "price_change_1h": 8.2,    "volume_zscore": 3.1  },  "onchain": {    "large_wallet_netflow_usd": 4200000  },  "sources": ["CoinGecko", "NOWNodes"],  "verification": {    "chainlink_cre": true  }}


## 11. Optional Demo Enhancements

Telegram Signal Alerts — P2

Add only after the core flow works. The bot should have one job: push high-confidence CoinGraph alerts.

🚨 CoinGraph SignalAAVE — Unusual Activity DetectedPrice: +7.8% / 1hVolume anomaly: highLarge-wallet accumulation: detectedEvidence confidence: 87%✓ Market: CoinGecko✓ Onchain: NOWNodes✓ Verified: Chainlink CRE[Investigate]

Trigger only above a confidence threshold and with multiple supporting signals.

Deep link to the web investigation page.

Do not build a full Telegram command-based analytics bot.

LangSmith / agent observability — P2

Useful internally, not part of the main pitch. Trace tool calls, failures, latency and agent behavior. Keep a trace ready only for technical judge questions.


## 12. Technical Architecture

┌──────────────────┐                         │ Human Demo UI    │                         │ thin visualization│                         └────────┬─────────┘                                  │AI Agent / Claude ──→ MCP Server ─┤                                  ▼                         ┌──────────────────┐                         │  CoinGraph API   │                         └────────┬─────────┘                                  │                 ┌────────────────┼────────────────┐                 ▼                ▼                ▼           Discovery Engine   Investigation     Payment                 │              Engine           Flow                 ▼                │             CoinGecko            ├────→ NOWNodes                 │                └────→ Optional structured data                 └──────────────┬─────────────────┘                                ▼                         Signal Engine                                ▼                         Evidence Package                                ▼                          LLM Explanation                                ▼                         Chainlink CRE                                ▼                      Intelligence Receipt                                ▼                           PostgreSQL

Recommended stack

Component

Recommendation

Frontend

Next.js

Backend

FastAPI or Node/TypeScript — use team familiarity

Database

PostgreSQL

Cache

Redis optional

Scheduler

Cron / lightweight worker

Market data

CoinGecko

Onchain

NOWNodes

Reasoning

CoinGraph rules + LLM explanation

Verification

Chainlink CRE

Background worker

Every ~3 minutes:1. Fetch Top-100 market batch2. Save snapshots3. Calculate baselines/anomaly scores4. Trigger investigations when thresholds are crossed5. Queue result for API/UI/optional Telegram


## 13. Stage Demo: 60–90 Seconds

Open CoinGraph and show: “Monitoring Top 100 assets.”

Ask: “Find unusual crypto activity.”

CoinGraph identifies one anomaly from the monitoring layer.

Show the agent requesting a deep investigation.

Show the payment step completing programmatically.

Investigation timeline lights up: market → onchain → signals → verification.

Show CoinGecko market evidence.

Show NOWNodes onchain evidence.

Show CoinGraph’s correlated signal and explanation.

Show Chainlink CRE verification / intelligence receipt.

Switch briefly to the MCP/agent view and show the same intelligence being consumed as structured JSON.

Optional wow moment

If Telegram is ready: show a CoinGraph alert arriving before opening the investigation. Do not depend on a live spontaneous anomaly; have a safe demo path.

Final demo screen

VERIFIED CRYPTO SIGNALAsset: AAVE | Signal: unusual large-wallet accumulation | Market: CoinGecko | Onchain: NOWNodes | Reasoning: CoinGraph | Verification: Chainlink CRE | Purchased autonomously by an AI agent


## 14. 36-Hour Build Plan

Time

Focus

Deliverable

0–6h

Data + schema

Top-100 CoinGecko monitor, PostgreSQL schema, 3–5 demo assets

6–14h

Signal engine

Baselines, anomaly rules, investigation trigger, NOWNodes evidence

14–22h

Agent product

CoinGraph API, MCP tools, payment flow

22–29h

Verification

Chainlink CRE workflow + intelligence receipt

29–36h

Demo polish

Thin frontend, fallback data path, optional Telegram, pitch rehearsal


## 15. Hackathon MVP Checklist

P0 — must work

Top-100 lightweight market monitor.

Historical baseline sufficient for anomaly detection.

At least 3–5 demo assets mapped correctly to chains/contracts.

One real CoinGecko market-data flow.

One real NOWNodes investigation flow.

Deterministic CoinGraph signal engine.

Evidence provenance stored with timestamps/source/tx hash where relevant.

CoinGraph investigation API.

At least 3 MCP tools.

Working agent payment flow.

Working Chainlink CRE workflow.

Machine-readable intelligence result.

One polished investigation frontend.

Fallback/cached demo case if live conditions are quiet.

P1 — highly desirable

Confidence scoring.

Intelligence receipt page.

Wallet labels for demo assets.

Clear developer/API panel.

Second demo asset / second investigation path.

P2 — only if core is stable

Telegram CoinGraph Signals bot.

LangSmith traces/evals.

GoldRush enrichment.

Wallet X-Ray.

More chains/tokens.


## 16. Judge Story

Problem: agents have access to data but lack reliable crypto context and synthesis.

Innovation: CoinGraph sells evidence-backed decisions/signals, not another raw-data endpoint.

Technical depth: market monitoring + direct onchain evidence + deterministic signals + LLM explanation + verifiable workflow + agent payments + MCP.

Sponsor fit: NOWNodes is a core evidence source; Chainlink CRE is a core verification workflow; agent commerce is visible in the paid investigation flow.

Business model: pay-per-intelligence for agents, with API/enterprise access later.

Expansion: Top 100 → Top 1,000 → any supported token/contract; more signals, richer wallet labels and continuous intelligence.


## 17. Pitch Scripts

Networking

15-second versionWe’re building CoinGraph — decision infrastructure for crypto. We turn fragmented market and onchain data into verifiable signals that AI agents can understand and act on.

Judge / builder

30-second versionAI agents can already hold wallets and transact, but raw crypto APIs still leave them to figure out what the data means. CoinGraph monitors the market, investigates unusual activity onchain, correlates the evidence and returns a structured, verifiable signal. Agents can call CoinGraph through MCP, pay for a deep investigation on demand, and use the result immediately.

Simple technology explanation

CoinGecko tells us what the market is doing.

NOWNodes tells us what is happening onchain.

CoinGraph figures out what it means.

Chainlink CRE verifies the workflow.

The payment layer lets agents buy the intelligence automatically.

Closing line

Data providers tell agents what happened.CoinGraph tells them what matters.

Discover → Pay → Investigate → Verify → Explain


## 18. Final Build Decision

Build this — and stop adding scopeAgents-first CoinGraph API + MCP, Top-100 lightweight monitoring, on-demand NOWNodes investigations, deterministic signal engine, Chainlink CRE verification, agent payment flow, and one thin human investigation UI. Telegram, LangSmith, GoldRush and Wallet X-Ray are optional only after the core path is stable.
