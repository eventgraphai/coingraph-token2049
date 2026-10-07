#!/usr/bin/env bash
# Keeps the CRE simulator attesting new CoinGraph proofs: one simulated run every INTERVAL seconds.
# Usage: cre/attest-loop.sh [interval-seconds]   (needs cre/.env with CRE_SECRET_COINGRAPH_ATTEST_KEY)
set -u
cd "$(dirname "$0")"
INTERVAL="${1:-300}"
while true; do
  echo "[$(date -u +%FT%TZ)] simulate"
  cre workflow simulate ./verify-investigation --target staging-settings --non-interactive --trigger-index 0 2>&1 | grep -E "USER LOG\]|Simulation Result|execution failed|✗"
  sleep "$INTERVAL"
done
