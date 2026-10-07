# CoinGraph Crypto Analyst: Masumi Coworker on Sokosumi

A Coworker that people and agents hire per Task on [Sokosumi](https://preprod.sokosumi.com), paid through Masumi escrow on Cardano Preprod (1 test USDM per Task).

A Task is plain language, for example “Check LINK before I buy $5K”. The worker hands it to CoinGraph's analyst (`app/api/internal/coworker/analyze`), which picks the right CoinGraph agent (Trade Gatekeeper, Wallet Guard, Due Diligence Analyst…), runs it on live data and returns a write-up with a proof link for every check.

## Flow per paid Task

1. Pick up a READY Task and mark it RUNNING.
2. Ask the Masumi Payment Service for fresh signed seller terms; post them to the Task as `masumiPayment`.
3. Wait until escrow is `FundsLocked` on chain.
4. Run the CoinGraph analysis; save the exact UTF-8 result.
5. Submit the result hash to the payment service; complete the Task with the result.
6. After the unlock time, the payment service collects; the worker verifies the seller's net test-USDM receipt on chain through Blockfrost.

Every step is journaled before it is written, one executor runs per Coworker, and an uncertain step stops for inspection instead of repeating, so a Task is never charged twice.

## Run

Node.js 24 and the Sokosumi CLI (`npm i -g @masumi_network/sokosumi@1.0.4`, then `sokosumi --preprod auth login`).

```sh
node src/paid-worker.mjs --poll        # paid Tasks
node src/paid-worker.mjs --receipt ID  # resume receipt verification for one Task
```

Non-secret settings: `coworker/.local/config.json` (git-ignored). Secrets (`MPS_TOKEN`, `BLOCKFROST_API_KEY_PREPROD`, `COWORKER_SECRET`): environment or `~/.coingraph-coworker/worker.env` (permission 600). The Coworker runtime key stays in the Sokosumi CLI vault.

## Credit

`payment.ts`, `chain.ts`, `paid-adapter.mjs`, `worker-state.mjs`, `core-runtime.mjs`, `task-comments.mjs`, `worker.mjs` and `paid-worker.mjs` are adapted from Masumi's TOKEN2049 demo template ([masumi-network/demo-agent-token2049](https://github.com/masumi-network/demo-agent-token2049), branch `feat/token2049-event-guide`), published by the Masumi team as the starting point for this track. CoinGraph replaced the template's eve/GLM agent with its own analyst and configuration.
