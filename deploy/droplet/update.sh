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
REPO=$ROOT/repo
STATUS=$ROOT/status
ENV=$ROOT/.env
BACKUPS=$ROOT/backups
LAST_GOOD_FILE=$ROOT/last-good

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
    for s in db-roles migrate web worker caddy; do
      echo; echo "== $s (last 60 lines) =="
      compose logs --no-color --tail 60 "$s" 2>&1 | sed -E 's/(password|secret|token|key)=[^ &"]+/\1=***/gI'
    done
  } > "$STATUS/runtime.txt.tmp" 2>&1 && mv "$STATUS/runtime.txt.tmp" "$STATUS/runtime.txt"
}

# .env is rebuilt on every deploy from three layers, a later one replacing an earlier value of the same key:
#   /opt/spa/.env.base (first-boot env)
#   < deploy/droplet/secrets.env.enc (encrypted overlay, AES-256 with the key in /opt/spa/secrets.key: secrets
#     without SSH)
#   < deploy/droplet/site.env (plain, public settings only: the SITE_KEYS lines; CI checks the file, test-update.sh)
# Each commit carries its own layers, so a rollback (deploy_commit LAST_GOOD) also restores the previous env. With
# neither an overlay nor a site.env, .env is left as it is.
SITE_KEYS="SITE_HOST ROUTING APP_URL ADMIN_URL EXTRA_ROOT_DOMAINS ACME_EMAIL VAPID_SUBJECT CF_CNAME_TARGET EMAIL_FROM"

# site_lines <file>: its KEY=value lines with a SITE_KEYS key (comments + blank lines ignored); others → stderr.
site_lines() {
  local line n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ $line =~ ^([A-Z][A-Z0-9_]*)= ]] && [[ " $SITE_KEYS " == *" ${BASH_REMATCH[1]} "* ]]; then
      printf '%s\n' "$line"
    elif [[ $line =~ ^([A-Z][A-Z0-9_]*)= ]]; then
      echo "site.env line $n skipped: ${BASH_REMATCH[1]} is not a site.env key ($SITE_KEYS)" >&2
    else
      echo "site.env line $n skipped: not KEY=value" >&2
    fi
  done <"$1"
}

# layer <dotenv text>: stdin without the lines for keys the text sets, then the text.
layer() {
  grep -v -E -f <(printf '%s\n' "$1" | sed -n 's/^\([A-Z0-9_]*\)=.*/^\1=/p')
  printf '%s\n' "$1"
}

build_env() {
  local enc=$REPO/deploy/droplet/secrets.env.enc site_file=$REPO/deploy/droplet/site.env base=$ROOT/.env.base
  local overlay='' plain site=''
  [ -f $ROOT/secrets.key ] && [ -f "$enc" ] && overlay=1
  [ -n "$overlay" ] || [ -f "$site_file" ] || return 0
  [ -f "$base" ] || cp $ROOT/.env "$base"
  if [ -n "$overlay" ]; then
    plain=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass file:$ROOT/secrets.key -in "$enc" 2>/dev/null) || { status error "secrets overlay could not be decrypted"; return 1; }
  fi
  [ -f "$site_file" ] && site=$(site_lines "$site_file" 2>>"$STATUS/build.log")
  umask 077
  if [ -n "$overlay" ]; then layer "$plain" <"$base"; else cat "$base"; fi |
    if [ -n "$site" ]; then layer "$site"; else cat; fi > $ROOT/.env.new && mv $ROOT/.env.new $ROOT/.env
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

# F26: Caddy reads the Caddyfile through a single-file bind mount. The hard reset below replaces that file, which the
# running container never sees (it keeps the old inode) and `compose up -d` doesn't recreate it, so a changed
# Caddyfile is applied by restarting caddy (the restart re-mounts the path). CI validated the file
# (deploy/droplet/test-caddy-ip.sh); if Caddy still doesn't come up, the deploy fails and the rollback restores the
# previous file the same way.
caddy_sync() {
  local want
  want=$(sha256sum "$REPO/deploy/droplet/Caddyfile" | cut -d' ' -f1)
  caddy_runs() {
    [ "$(compose exec -T caddy sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1)" = "$want" ] &&
      compose exec -T caddy wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1
  }
  caddy_runs && return 0
  echo "== Caddyfile changed: restarting caddy ==" >>"$STATUS/build.log"
  compose restart caddy >>"$STATUS/build.log" 2>&1 || return 1
  for _ in $(seq 1 15); do caddy_runs && return 0; sleep 2; done
  compose logs --no-color --tail 30 caddy >>"$STATUS/build.log" 2>&1
  return 1
}

# deploy_commit <sha> [--no-dump] → 0 ok · 10 build · 11 dump · 12 start/migrate · 13 health
deploy_commit() {
  local sha=$1
  git reset -q --hard "$sha" || return 12
  build_env || true
  export APP_RELEASE="${sha:0:7}"
  compose build --pull >>"$STATUS/build.log" 2>&1 || return 10
  if [ "${2:-}" != "--no-dump" ]; then pre_migrate_dump "$sha" || return 11; fi
  compose up -d --remove-orphans >>"$STATUS/build.log" 2>&1 || return 12
  caddy_sync || return 12
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

# Sourced by deploy/droplet/test-update.sh for the functions above: stop here.
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

exec 9>"${SPA_LOCK:-/var/lock/spa-update.lock}"
flock -n 9 || exit 0
BRANCH=$(cat $ROOT/branch)
GREEN=$(cat $ROOT/green-ref 2>/dev/null || echo deploy/green)
FORCE=${1:-}
cd "$REPO" || exit 1
mkdir -p "$STATUS" "$BACKUPS"

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
