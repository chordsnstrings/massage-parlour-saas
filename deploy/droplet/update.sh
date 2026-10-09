#!/usr/bin/env bash
# Pull-based deploy (systemd timer, every 2 minutes). Deploys only commits whose CI passed: CI moves the branch
# `deploy/green` to each green commit of the deploy branch (.github/workflows/ci.yml, job `promote`) and this script
# deploys that ref, never the raw branch tip. Until deploy/green exists once, it falls back to the branch tip.
# Each deploy: build → pg_dump (pre-migrate) → migrate + restart → health check; a failed deploy rolls back to the
# last good commit (/opt/spa/last-good). `spa-update --force` redeploys (also retries a commit that failed).
# Status + recent logs → /opt/spa/status (served at /_status/, basic auth).
set -uo pipefail
# SPA_ROOT / SPA_LOCK / DOCKER_DAEMON_JSON exist for the shell test (deploy/droplet/test-update.sh) only.
ROOT=${SPA_ROOT:-/opt/spa}
exec 9>"${SPA_LOCK:-/var/lock/spa-update.lock}"
flock -n 9 || exit 0

REPO=$ROOT/repo
STATUS=$ROOT/status
ENV=$ROOT/.env
BACKUPS=$ROOT/backups
LAST_GOOD_FILE=$ROOT/last-good
BRANCH=$(cat $ROOT/branch)
GREEN=$(cat $ROOT/green-ref 2>/dev/null || echo deploy/green)
FORCE=${1:-}
cd "$REPO" || exit 1
mkdir -p "$STATUS" "$BACKUPS"

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '; }
status() { # state message
  printf '{"state":"%s","commit":"%s","branch":"%s","gate":"%s","at":"%s","message":"%s"}\n' \
    "$1" "${NEW:-}" "$BRANCH" "${GATE:-}" "$(date -u +%FT%TZ)" "$(json_escape "$2")" \
    > "$STATUS/deploy.json.tmp" && mv "$STATUS/deploy.json.tmp" "$STATUS/deploy.json"
}
compose() { (cd "$REPO/deploy/droplet" && docker compose --env-file "$ENV" "$@"); }
snapshot() {
  {
    echo "== $(date -u +%FT%TZ) =="
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    echo; free -m | head -2; df -h / | tail -1
    for s in migrate web worker caddy; do
      echo; echo "== $s (last 60 lines) =="
      compose logs --no-color --tail 60 "$s" 2>&1 | sed -E 's/(password|secret|token|key)=[^ &"]+/\1=***/gI'
    done
  } > "$STATUS/runtime.txt.tmp" 2>&1 && mv "$STATUS/runtime.txt.tmp" "$STATUS/runtime.txt"
}

# Encrypted secrets overlay committed in the repo (deploy/droplet/secrets.env.enc, AES-256 with the key in
# /opt/spa/secrets.key): lets the operator add or rotate secrets without SSH. Overlay keys win over /opt/spa/.env.
apply_overlay() {
  local enc="$REPO/deploy/droplet/secrets.env.enc" base=$ROOT/.env.base
  [ -f $ROOT/secrets.key ] && [ -f "$enc" ] || return 0
  [ -f "$base" ] || cp $ROOT/.env "$base"
  local plain
  plain=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass file:$ROOT/secrets.key -in "$enc" 2>/dev/null) || { status error "secrets overlay could not be decrypted"; return 1; }
  umask 077
  {
    grep -v -E -f <(printf '%s\n' "$plain" | sed -n 's/^\([A-Z0-9_]*\)=.*/^\1=/p') "$base"
    printf '%s\n' "$plain"
  } > $ROOT/.env.new && mv $ROOT/.env.new $ROOT/.env
  umask 022
}

# G8: rotate container logs (json-file, 5 × 10 MB). compose.yml sets the same per service, which applies at once;
# daemon.json covers every other container from the next Docker restart (not forced here: it would bounce the stack).
ensure_log_rotation() {
  local f=${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}
  if [ -f "$f" ] && grep -q '"max-size"' "$f"; then return 0; fi
  python3 - "$f" <<'PY' || true
import json, os, sys
path = sys.argv[1]
cfg = {}
if os.path.exists(path):
    try:
        cfg = json.load(open(path))
    except ValueError:
        sys.exit(0)  # leave a hand-edited file alone
cfg.setdefault("log-driver", "json-file")
cfg.setdefault("log-opts", {}).update({"max-size": "10m", "max-file": "5"})
tmp = path + ".tmp"
json.dump(cfg, open(tmp, "w"), indent=2)
os.replace(tmp, path)
PY
}

# Which commit to deploy: the CI-green ref when it exists (it must be part of the deploy branch's history).
pick_commit() {
  git fetch -q origin "$BRANCH" || { status error "git fetch failed"; return 1; }
  TIP=$(git rev-parse "origin/$BRANCH")
  if git fetch -q origin "+refs/heads/$GREEN:refs/remotes/origin/$GREEN" 2>/dev/null; then
    touch $ROOT/ci-gated
    NEW=$(git rev-parse "origin/$GREEN")
    GATE="ci"
    if ! git merge-base --is-ancestor "$NEW" "$TIP"; then
      status error "$GREEN (${NEW:0:7}) is not on $BRANCH; not deploying"; return 1
    fi
  elif [ -f $ROOT/ci-gated ]; then
    # The gate was active before: never fall back to an unchecked tip because a fetch failed.
    status error "could not fetch $GREEN"; return 1
  else
    NEW=$TIP
    GATE="none ($GREEN missing; deploying the branch tip)"
  fi
  printf '{"branch_tip":"%s","green":"%s","gate":"%s","at":"%s"}\n' "$TIP" "$NEW" "$GATE" "$(date -u +%FT%TZ)" \
    > "$STATUS/gate.json"
}

health() {
  for _ in $(seq 1 60); do
    compose exec -T web wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

# G7: custom-format dump before migrations run (keeps the newest 5). Restore: deploy/droplet/README.md.
pre_migrate_dump() {
  local sha=$1
  compose up -d postgres >>"$STATUS/build.log" 2>&1 || return 1
  for _ in $(seq 1 30); do compose exec -T postgres pg_isready -U postgres -d spa >/dev/null 2>&1 && break; sleep 2; done
  compose exec -T postgres pg_dump -U postgres -Fc spa -f "/backups/pre-migrate-${sha:0:12}.dump.tmp" >>"$STATUS/build.log" 2>&1 || return 1
  mv "$BACKUPS/pre-migrate-${sha:0:12}.dump.tmp" "$BACKUPS/pre-migrate-${sha:0:12}.dump" || return 1
  ls -1t "$BACKUPS"/pre-migrate-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
}

# deploy_commit <sha> [--no-dump] → 0 ok · 10 build · 11 dump · 12 start/migrate · 13 health
deploy_commit() {
  local sha=$1
  git reset -q --hard "$sha" || return 12
  apply_overlay || true
  export APP_RELEASE="${sha:0:7}"
  compose build --pull >>"$STATUS/build.log" 2>&1 || return 10
  if [ "${2:-}" != "--no-dump" ]; then pre_migrate_dump "$sha" || return 11; fi
  compose up -d --remove-orphans >>"$STATUS/build.log" 2>&1 || return 12
  health || return 13
}

reason() {
  case $1 in
    10) echo "build failed" ;;
    11) echo "pre-migrate backup failed" ;;
    12) echo "start or migration failed" ;;
    *) echo "web not healthy (/api/health)" ;;
  esac
}

ensure_log_rotation
pick_commit || { snapshot; exit 1; }
CUR=$(cat "$STATUS/deployed" 2>/dev/null || true)
[ -f "$LAST_GOOD_FILE" ] || { [ -n "$CUR" ] && echo "$CUR" > "$LAST_GOOD_FILE"; }
LAST_GOOD=$(cat "$LAST_GOOD_FILE" 2>/dev/null || true)
if [ "$FORCE" != "--force" ]; then
  if [ "$NEW" = "$CUR" ]; then snapshot; exit 0; fi
  # A commit that failed once is not retried every 2 minutes (push a fix, or spa-update --force).
  if [ "$NEW" = "$(cat "$STATUS/failed" 2>/dev/null)" ]; then snapshot; exit 0; fi
fi

status building "building ${NEW:0:7}"
: > "$STATUS/build.log"
deploy_commit "$NEW"
rc=$?
if [ $rc -eq 0 ]; then
  echo "$NEW" > "$STATUS/deployed"
  echo "$NEW" > "$LAST_GOOD_FILE"
  rm -f "$STATUS/failed"
  status ok "deployed ${NEW:0:7}"
  docker image prune -f >/dev/null 2>&1
  snapshot; exit 0
fi

FAILED=$NEW
echo "$FAILED" > "$STATUS/failed"
why=$(reason $rc)
if [ -n "$LAST_GOOD" ] && [ "$LAST_GOOD" != "$FAILED" ]; then
  status rolling_back "${why} for ${FAILED:0:7}; rolling back to ${LAST_GOOD:0:7}"
  echo "== rollback to $LAST_GOOD ==" >>"$STATUS/build.log"
  # Migrations are not reverted (they are additive); the pre-migrate dump is there if data must be restored.
  if deploy_commit "$LAST_GOOD" --no-dump; then
    echo "$LAST_GOOD" > "$STATUS/deployed"
    status failed "${why} for ${FAILED:0:7}; rolled back to ${LAST_GOOD:0:7} (see /_status/build.log)"
  else
    status failed "${why} for ${FAILED:0:7}; rollback to ${LAST_GOOD:0:7} also failed (see /_status/build.log)"
  fi
else
  status failed "${why} for ${FAILED:0:7}; no earlier good commit to roll back to (see /_status/build.log)"
fi
snapshot; exit 1
