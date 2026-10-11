#!/usr/bin/env bash
# CI (job guards): update.sh build_env, which rebuilds /opt/spa/.env as .env.base < secrets.env.enc < site.env,
# against fixtures in a temp dir; then the committed deploy/droplet/site.env (allowed keys only, no duplicates, and
# SITE_HOST / ROUTING / APP_URL / ADMIN_URL set together and matching). Needs bash, openssl, grep, sed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
R=$work/root
export SPA_ROOT=$R
# shellcheck source=deploy/droplet/update.sh
source "$here/update.sh" # defines the functions and stops before the deploy itself
export BRANCH="test"     # read by status()

fails=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  fails=$((fails + 1))
}
same() { if cmp -s "$2" "$3"; then ok "$1"; else bad "$1" && diff "$2" "$3" || true; fi; }
reset() {
  rm -rf "$R"
  mkdir -p "$R/repo/deploy/droplet" "$R/status"
  : >"$R/status/build.log"
}
run_build_env() {
  rc=0
  build_env || rc=$?
}
mode() { stat -c %a "$1"; }

BASE="SITE_HOST=134-209-145-162.sslip.io
ROUTING=path
ACME_EMAIL=old@example.com
SECRET=base
STATUS_HASH='\$2a\$14\$abc'"
OVERLAY="SECRET=overlay
ACME_EMAIL=overlay@example.com
NEW_SECRET=x"
encrypt() { # encrypt <plain text>: the overlay as the operator makes it (README "Secrets without SSH")
  printf 'test-key' >"$R/secrets.key"
  printf '%s\n' "$1" >"$work/plain"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass file:"$R/secrets.key" \
    -in "$work/plain" -out "$R/repo/deploy/droplet/secrets.env.enc"
}

echo "== no overlay, no site.env: .env untouched"
reset
printf '%s\n' "$BASE" >"$R/.env"
chmod 640 "$R/.env"
cp -p "$R/.env" "$work/before"
run_build_env
same "same bytes" "$work/before" "$R/.env"
[ "$rc" = 0 ] && [ "$(mode "$R/.env")" = 640 ] && [ ! -e "$R/.env.base" ] && [ ! -e "$R/.env.new" ] &&
  ok "rc 0, mode kept, no .env.base" || bad "rc 0, mode kept, no .env.base (rc=$rc)"

echo "== overlay only: as before site.env existed"
reset
printf '%s\n' "$BASE" >"$R/.env"
encrypt "$OVERLAY"
run_build_env
# The pre-site.env updater's merge (apply_overlay), byte for byte.
{
  grep -v -E -f <(printf '%s\n' "$OVERLAY" | sed -n 's/^\([A-Z0-9_]*\)=.*/^\1=/p') "$R/.env.base"
  printf '%s\n' "$OVERLAY"
} >"$work/want"
same "base < overlay, same bytes as apply_overlay" "$work/want" "$R/.env"
[ "$rc" = 0 ] && [ "$(mode "$R/.env")" = 600 ] && ok "rc 0, mode 600" || bad "rc 0, mode 600 (rc=$rc)"
printf '%s\n' "$BASE" >"$work/want"
same ".env.base created from the first-boot .env" "$work/want" "$R/.env.base"

echo "== base < overlay < site.env, allow-list, malformed lines"
reset
printf '%s\n' "$BASE" >"$R/.env.base"
printf 'stale\n' >"$R/.env"
encrypt "$OVERLAY"
printf '%s\n' '# comment' '   # indented comment' '' \
  'ACME_EMAIL=ask@spamanagement.co' 'SITE_HOST=spamanagement.co' 'SECRET=from-site-env' 'export ROUTING=path' \
  'lower=x' 'ROUTING=host'$'\r' 'EMAIL_FROM="spamanagement.co <ask@spamanagement.co>"' >"$R/repo/deploy/droplet/site.env"
printf 'APP_URL=https://app.spamanagement.co' >>"$R/repo/deploy/droplet/site.env" # last line without a newline
run_build_env
printf '%s\n' "STATUS_HASH='\$2a\$14\$abc'" 'SECRET=overlay' 'NEW_SECRET=x' 'ACME_EMAIL=ask@spamanagement.co' \
  'SITE_HOST=spamanagement.co' 'ROUTING=host' 'EMAIL_FROM="spamanagement.co <ask@spamanagement.co>"' \
  'APP_URL=https://app.spamanagement.co' >"$work/want"
same "site.env wins for its keys, overlay over base, others skipped" "$work/want" "$R/.env"
[ "$rc" = 0 ] && [ "$(mode "$R/.env")" = 600 ] && ok "rc 0, mode 600" || bad "rc 0, mode 600 (rc=$rc)"
log=$(cat "$R/status/build.log")
[[ $log == *"line 6 skipped: SECRET is not a site.env key"* && $log == *"line 7 skipped: not KEY=value"* &&
  $log == *"line 8 skipped: not KEY=value"* && $(grep -c skipped <<<"$log") == 3 ]] &&
  ok "skipped lines logged (comments and blanks not)" || bad "skipped lines logged: $log"
[[ $log != *from-site-env* ]] && ok "skipped values are not logged" || bad "skipped values are not logged"
run_build_env
same "rebuilding gives the same .env" "$work/want" "$R/.env"

echo "== site.env only, no .env.base yet"
reset
printf '%s\n' "$BASE" >"$R/.env"
printf 'SITE_HOST=spamanagement.co\nVAPID_SUBJECT=mailto:ask@spamanagement.co\n' >"$R/repo/deploy/droplet/site.env"
run_build_env
printf '%s\n' 'ROUTING=path' 'ACME_EMAIL=old@example.com' 'SECRET=base' "STATUS_HASH='\$2a\$14\$abc'" \
  'SITE_HOST=spamanagement.co' 'VAPID_SUBJECT=mailto:ask@spamanagement.co' >"$work/want"
same "base < site.env" "$work/want" "$R/.env"
[ -f "$R/.env.base" ] && [ "$rc" = 0 ] && ok ".env.base created, rc 0" || bad ".env.base created, rc 0 (rc=$rc)"

echo "== overlay that can't be decrypted: .env untouched, error status"
reset
printf '%s\n' "$BASE" >"$R/.env"
encrypt "$OVERLAY"
printf 'other-key' >"$R/secrets.key"
printf 'SITE_HOST=spamanagement.co\n' >"$R/repo/deploy/droplet/site.env"
cp -p "$R/.env" "$work/before"
run_build_env
same "same bytes" "$work/before" "$R/.env"
[ "$rc" = 1 ] && grep -q '"state":"error".*could not be decrypted' "$R/status/deploy.json" &&
  ok "rc 1, deploy.json error" || bad "rc 1, deploy.json error (rc=$rc)"

# check_site <file>: problems with a site.env, one per line (none = fine).
check_site() {
  local skipped lines dups host routing app admin
  skipped=$(site_lines "$1" 2>&1 >/dev/null)
  [ -z "$skipped" ] || printf '%s\n' "$skipped"
  lines=$(site_lines "$1" 2>/dev/null)
  dups=$(printf '%s\n' "$lines" | sed -n 's/=.*//p' | sort | uniq -d | tr '\n' ' ')
  [ -z "$dups" ] || echo "set more than once: $dups"
  empty=$(printf '%s\n' "$lines" | sed -n -E "s/^([A-Z0-9_]+)=(\"\"|''|)$/\1/p" | tr '\n' ' ')
  [ -z "$empty" ] || echo "empty value (comment the line out instead): $empty"
  val() { printf '%s\n' "$lines" | sed -n "s/^$1=//p" | tail -n 1 | sed -E "s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"; }
  host=$(val SITE_HOST) routing=$(val ROUTING) app=$(val APP_URL) admin=$(val ADMIN_URL)
  [ -n "$host$routing$app$admin" ] || return 0
  if [ -z "$host" ] || [ -z "$routing" ] || [ -z "$app" ] || [ -z "$admin" ]; then
    echo "SITE_HOST, ROUTING, APP_URL and ADMIN_URL must be set together"
    return 0
  fi
  [[ $host =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $host == *.* ]] || echo "SITE_HOST is not a hostname: $host"
  case $routing in
    host) [ "$app" = "https://app.$host" ] && [ "$admin" = "https://admin.$host" ] ||
      echo "ROUTING=host needs APP_URL=https://app.$host and ADMIN_URL=https://admin.$host" ;;
    path) [ "$app" = "https://$host" ] && [ "$admin" = "https://$host/admin" ] ||
      echo "ROUTING=path needs APP_URL=https://$host and ADMIN_URL=https://$host/admin" ;;
    *) echo "ROUTING must be host or path: $routing" ;;
  esac
}
rejects() { # rejects <name> <site.env text>
  printf '%s\n' "$2" >"$work/site.env"
  [ -n "$(check_site "$work/site.env")" ] && ok "check rejects: $1" || bad "check rejects: $1"
}

echo "== the site.env check itself"
rejects "a key outside the allow-list" 'BETTER_AUTH_SECRET=x'
rejects "a partial domain set" 'SITE_HOST=spamanagement.co'
rejects "APP_URL not app.<SITE_HOST>" $'SITE_HOST=spamanagement.co\nROUTING=host\nAPP_URL=https://spamanagement.co\nADMIN_URL=https://admin.spamanagement.co'
rejects "a duplicate key" $'ACME_EMAIL=a@b.co\nACME_EMAIL=c@d.co'
rejects "an empty value" 'SITE_HOST='
rejects "an empty quoted value" 'EMAIL_FROM=""'
printf '# nothing set\n' >"$work/site.env"
[ -z "$(check_site "$work/site.env")" ] && ok "check accepts an all-comments file" || bad "check accepts an all-comments file"

echo "== committed deploy/droplet/site.env"
problems=$(check_site "$here/site.env")
keys=$(site_lines "$here/site.env" 2>/dev/null | sed 's/=.*//' | tr '\n' ' ')
keys=${keys% }
[ -z "$problems" ] && ok "valid (sets: ${keys:-nothing})" ||
  bad "deploy/droplet/site.env: $problems"

if [ "$fails" != 0 ]; then
  echo "$fails updater env check(s) failed." >&2
  exit 1
fi
echo "Updater env checks passed."
