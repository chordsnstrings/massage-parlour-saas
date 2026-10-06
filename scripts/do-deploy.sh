#!/usr/bin/env bash
# Triggers a new App Platform deployment (rebuild from the configured branch) and waits for the result.
# Usage: DO_TOKEN=... APP_ID=... bash scripts/do-deploy.sh
set -euo pipefail
: "${DO_TOKEN:?DO_TOKEN is required}" "${APP_ID:?APP_ID is required}"
api() { curl -fsS -H "Authorization: Bearer $DO_TOKEN" -H "Content-Type: application/json" "$@"; }
DEP=$(api -X POST "https://api.digitalocean.com/v2/apps/$APP_ID/deployments" -d '{"force_build":true}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployment"]["id"])')
echo "deployment $DEP started"
last=""
for _ in $(seq 1 180); do
  PHASE=$(api "https://api.digitalocean.com/v2/apps/$APP_ID/deployments/$DEP" | python3 -c 'import json,sys; d=json.load(sys.stdin)["deployment"]; p=d.get("progress",{}); print(d["phase"], f"{p.get(\"success_steps\")}/{p.get(\"total_steps\")}")')
  [ "$PHASE" != "$last" ] && echo "$(date -u +%H:%M:%S) $PHASE" && last="$PHASE"
  case "$PHASE" in ACTIVE*) exit 0 ;; ERROR*|CANCELED*|SUPERSEDED*) exit 1 ;; esac
  sleep 15
done
echo "timed out waiting for deployment" >&2
exit 1
