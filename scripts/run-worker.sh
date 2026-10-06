#!/usr/bin/env bash
# Local supervisor: restart the worker if it exits (crash or watchdog), like Railway's restart policy.
cd "$(dirname "$0")/.."
while true; do
  npm run -s worker
  echo "[supervisor] worker exited with code $? — restarting in 5s"
  sleep 5
done
