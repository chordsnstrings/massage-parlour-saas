#!/usr/bin/env bash
# Pull-based deploy: every 2 minutes (systemd timer) check the deploy branch; on a new commit rebuild and restart.
# `spa-update --force` redeploys the current commit. Status + recent logs → /opt/spa/status (served at /_status/, basic auth).
set -uo pipefail
exec 9>/var/lock/spa-update.lock
flock -n 9 || exit 0

REPO=/opt/spa/repo
STATUS=/opt/spa/status
ENV=/opt/spa/.env
BRANCH=$(cat /opt/spa/branch)
cd "$REPO" || exit 1
mkdir -p "$STATUS"

status() { # state message
  printf '{"state":"%s","commit":"%s","branch":"%s","at":"%s","message":"%s"}\n' \
    "$1" "${NEW:-}" "$BRANCH" "$(date -u +%FT%TZ)" "$2" > "$STATUS/deploy.json.tmp" && mv "$STATUS/deploy.json.tmp" "$STATUS/deploy.json"
}
snapshot() {
  {
    echo "== $(date -u +%FT%TZ) =="
    (cd deploy/droplet && docker compose --env-file "$ENV" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}')
    echo; free -m | head -2; df -h / | tail -1
    for s in migrate web worker caddy; do
      echo; echo "== $s (last 60 lines) =="
      (cd deploy/droplet && docker compose --env-file "$ENV" logs --no-color --tail 60 "$s" 2>&1) | sed -E 's/(password|secret|token|key)=[^ &"]+/\1=***/gI'
    done
  } > "$STATUS/runtime.txt.tmp" 2>&1 && mv "$STATUS/runtime.txt.tmp" "$STATUS/runtime.txt"
}

git fetch -q origin "$BRANCH" || { status error "git fetch failed"; exit 1; }
NEW=$(git rev-parse "origin/$BRANCH")
CUR=$(cat "$STATUS/deployed" 2>/dev/null || true)
if [ "$NEW" = "$CUR" ] && [ "${1:-}" != "--force" ]; then snapshot; exit 0; fi

status building "building ${NEW:0:7}"
git reset -q --hard "$NEW"
cd deploy/droplet
export APP_RELEASE="${NEW:0:7}"
if ! docker compose --env-file "$ENV" build --pull >"$STATUS/build.log" 2>&1; then
  status failed "build failed (see /_status/build.log)"; cd "$REPO"; snapshot; exit 1
fi
if ! docker compose --env-file "$ENV" up -d --remove-orphans >>"$STATUS/build.log" 2>&1; then
  status failed "start failed (see /_status/build.log)"; cd "$REPO"; snapshot; exit 1
fi
for _ in $(seq 1 60); do
  if docker compose --env-file "$ENV" exec -T web wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "$NEW" > "$STATUS/deployed"
    status ok "deployed ${NEW:0:7}"
    docker image prune -f >/dev/null 2>&1
    cd "$REPO"; snapshot; exit 0
  fi
  sleep 5
done
status failed "web not healthy after deploy"
cd "$REPO"; snapshot; exit 1
