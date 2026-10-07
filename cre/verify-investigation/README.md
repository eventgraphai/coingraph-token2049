# verify-investigation — CoinGraph proof attestation on Chainlink CRE

Every answer CoinGraph issues (a check, an answer, an agent run, a brief) is stored exactly as issued and
fingerprinted: SHA-256 of the canonical JSON. `GET /api/v1/verify/{id}` serves the object, the fingerprint
and the source calls behind it. This workflow is the independent witness.

On a schedule it:

1. asks CoinGraph which proofs still lack an attestation (`GET /api/v1/attest`, keyed),
2. fetches each proof from the public `GET /api/v1/verify/{id}` on **every node**, recomputes the
   fingerprint from the served object, and requires the nodes to agree (`consensusIdenticalAggregation`),
3. posts the agreed attestations back (`POST /api/v1/attest`). CoinGraph re-hashes the object before
   storing, so neither side can attest a fingerprint the object does not hash to.

The attestation then appears in `/api/v1/verify/{id}` and on `/proof/{id}`.

## Files

| File | Purpose |
|---|---|
| `main.ts` | The workflow: cron trigger, HTTP fetches in node mode, identical consensus, HTTP post |
| `config.staging.json` / `config.production.json` | Schedule, CoinGraph origin, batch size, mode |
| `../secrets.yaml` | Maps the secret id `COINGRAPH_ATTEST_KEY` to the env var `CRE_SECRET_COINGRAPH_ATTEST_KEY` |
| `../.env` | Local secrets for simulation (gitignored) |
| `main.test.ts` | Unit tests (`bun test`): canonical JSON and fingerprint match the server |

## Run it

```bash
cd cre/verify-investigation
bun install
bun test
cd ..
cre workflow simulate ./verify-investigation --target staging-settings
```

The simulator runs the workflow as a local DON and performs the real HTTP calls against the live site.
Each run attests up to `batch` proofs; the log lists every id with its recomputed fingerprint.

## Status

Simulated on the CRE CLI (agreed with the Chainlink team for the hackathon). Attestations carry
`mode: "simulation"`. Deploying to a DON (`cre workflow deploy`) and publishing attestations on chain
are the next steps; the workflow code does not change for that, only `mode` in the production config.
