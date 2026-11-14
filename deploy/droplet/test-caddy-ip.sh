#!/usr/bin/env bash
# F26 (G6): validates deploy/droplet/Caddyfile, then runs its client-IP handling against a header-echo upstream and
# checks what the app (web:3000) would receive:
#  - direct hits (our own domains, spa custom domains, anyone reaching the droplet IP): forged Cf-Connecting-Ip /
#    X-Forwarded-For / X-Real-Ip / Do-Connecting-Ip / True-Client-Ip become, or are stripped to, the real peer IP;
#  - Cloudflare-proxied hits (the loopback is added to trusted_proxies to play Cloudflare): Cloudflare's
#    Cf-Connecting-Ip passes through (IPv4 + IPv6); X-Forwarded-For alone or a junk value is not a source.
# Both site blocks (SITE_HOST + the custom-domain catch-all) are exercised through the shared proxy_to_web snippet,
# and /_status/ (basic auth) on the main site and on the catch-all for the droplet's own <ip>.sslip.io fallback.
# Needs curl + python3, and `caddy` on PATH (or CADDY=/path/to/caddy), else docker with caddy:2-alpine (compose.yml).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
CADDY=${CADDY:-$(command -v caddy || true)}
IMAGE=caddy:2-alpine
# shellcheck disable=SC2016 # a literal bcrypt hash (of "test") for the /_status basic_auth
HASH='$2a$14$Cr0Mn8x1K6821f0K/BdpXuJ.F/793pSzHjrZu8SEmlnLl1CXyUPx.'
pid='' cid=''
stop() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  pid='' cid=''
}
trap 'stop; rm -rf "$work"' EXIT

caddy_cmd() { # caddy_cmd <dir> <env SITE_HOST> <args...>: run the caddy CLI with <dir> holding the config
  local dir=$1 site=$2
  local -a acme=()
  [ -z "${ACME_EMAIL+set}" ] || acme=(-e "ACME_EMAIL=$ACME_EMAIL") # passed on only when set (docker)
  shift 2
  if [ -n "$CADDY" ]; then
    (cd "$dir" && SITE_HOST="$site" STATUS_HASH="$HASH" XDG_DATA_HOME="$dir/data" XDG_CONFIG_HOME="$dir/cfg" "$CADDY" "$@")
  else
    docker run --rm -v "$dir:/w" -w /w -e SITE_HOST="$site" -e STATUS_HASH="$HASH" "${acme[@]}" "$IMAGE" caddy "$@"
  fi
}

echo "== caddy validate (production Caddyfile)"
mkdir -p "$work/prod"
cp "$here/Caddyfile" "$work/prod/Caddyfile"
(unset ACME_EMAIL; caddy_cmd "$work/prod" example.com validate --config Caddyfile --adapter caddyfile 2>&1 | tail -n 3)
# compose.yml always sets ACME_EMAIL for caddy, and Caddy only takes the Caddyfile's {$ACME_EMAIL:…} default when the
# variable is unset: an empty value leaves `email` without an argument and Caddy won't start. So compose's own
# default must be a non-empty address, and the Caddyfile must load with it.
echo "== caddy validate with compose.yml's ACME_EMAIL default"
acme_default=$(sed -n -E 's/^[[:space:]]*ACME_EMAIL: \$\{ACME_EMAIL:-([^}]+)\}.*/\1/p' "$here/compose.yml")
[[ $acme_default =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] ||
  { echo "compose.yml must give caddy a non-empty ACME_EMAIL default (got '$acme_default')" >&2; exit 1; }
ACME_EMAIL=$acme_default caddy_cmd "$work/prod" example.com validate --config Caddyfile --adapter caddyfile 2>&1 | tail -n 3

# Test copy: same global options + snippet + site blocks; local ports, plain HTTP, upstream = header echo.
make_config() { # make_config <out dir> <extra trusted ranges>
  python3 - "$here/Caddyfile" "$1/Caddyfile" "$2" <<'PY'
import sys
src, out, extra = sys.argv[1:4]
s = open(src).read()
def swap(old, new):
    global s
    assert s.count(old) == 1, f'Caddyfile changed shape: {old!r}'
    s = s.replace(old, new)
assert s.startswith('{\n'), 'Caddyfile must start with the global options block'
s = '{\n\tadmin off\n\thttp_port 18081\n\thttps_port 18443\n' + s[2:]
swap('reverse_proxy web:3000', 'reverse_proxy 127.0.0.1:18090')
swap('https:// {\n\ttls {\n\t\ton_demand\n\t}\n', 'http://:18082 {\n')
if extra:
    swap('trusted_proxies static ', f'trusted_proxies static {extra} ')
s += ('\nhttp://:18090 {\n\trespond "cf=[{header.Cf-Connecting-Ip}] xff=[{header.X-Forwarded-For}] '
      'real=[{header.X-Real-Ip}] do=[{header.Do-Connecting-Ip}] true=[{header.True-Client-Ip}]"\n}\n')
open(out, 'w').write(s)
PY
}

start() { # start <dir>
  local dir=$1
  if [ -n "$CADDY" ]; then
    (cd "$dir" && SITE_HOST=http://127.0.0.1:18080 STATUS_HASH="$HASH" XDG_DATA_HOME="$dir/data" \
      XDG_CONFIG_HOME="$dir/cfg" exec "$CADDY" run --config Caddyfile --adapter caddyfile) >"$dir/log" 2>&1 &
    pid=$!
  else
    cid=$(docker run -d --network host -v "$dir:/w" -w /w -e SITE_HOST=http://127.0.0.1:18080 \
      -e STATUS_HASH="$HASH" "$IMAGE" caddy run --config Caddyfile --adapter caddyfile)
  fi
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null http://127.0.0.1:18080/ 2>/dev/null && return 0
    sleep 0.2
  done
  cat "$dir/log" 2>/dev/null || docker logs "$cid" || true
  echo "caddy did not start" >&2
  exit 1
}

fails=0
check() { # check <name> <port> <expected substring> [curl -H args...]
  local name=$1 port=$2 want=$3 got
  shift 3
  got=$(curl -fsS "$@" "http://127.0.0.1:$port/")
  if [[ $got == *"$want"* ]]; then echo "ok   $name"; else
    echo "FAIL $name: want '$want', got '$got'"
    fails=$((fails + 1))
  fi
}
forged=(-H 'Cf-Connecting-Ip: 6.6.6.6' -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-Ip: 6.6.6.6'
  -H 'Do-Connecting-Ip: 6.6.6.6' -H 'True-Client-Ip: 6.6.6.6')

echo "== direct hits (peer is not Cloudflare)"
mkdir -p "$work/direct"
make_config "$work/direct" ''
start "$work/direct"
for port in 18080 18082; do
  check "forged headers replaced by the peer IP (:$port)" $port \
    'cf=[127.0.0.1] xff=[127.0.0.1] real=[] do=[] true=[]' "${forged[@]}"
done
check "no headers: peer IP" 18080 'cf=[127.0.0.1]'

echo "== /_status: main site, and the <ip>.sslip.io fallback on the catch-all (app hosts still reach the app)"
status_check() { # status_check <name> <want: http code | body substring> <port> <host> [curl args...]
  local name=$1 want=$2 port=$3 host=$4 got
  shift 4
  got=$(curl -s -w ' %{http_code}' -H "Host: $host" "$@" "http://127.0.0.1:$port/_status/deploy.json")
  if [[ $got == *"$want"* ]]; then echo "ok   $name"; else
    echo "FAIL $name: want '$want', got '$got'"
    fails=$((fails + 1))
  fi
}
status_check "main site asks for the password" ' 401' 18080 127.0.0.1:18080
status_check "fallback asks for the password" ' 401' 18082 134-209-145-162.sslip.io
status_check "fallback serves files once signed in (none here: 404)" ' 404' 18082 134-209-145-162.sslip.io -u ops:test
status_check "app.<ip>.sslip.io goes to the app" 'cf=[127.0.0.1]' 18082 app.134-209-145-162.sslip.io
status_check "a spa custom domain goes to the app" 'cf=[127.0.0.1]' 18082 book.example.com
stop

echo "== via Cloudflare (loopback trusted)"
mkdir -p "$work/cf"
make_config "$work/cf" '127.0.0.0/8 ::1/128'
start "$work/cf"
for port in 18080 18082; do
  check "Cloudflare's IPv4 passes through (:$port)" $port 'cf=[198.51.100.7]' \
    -H 'Cf-Connecting-Ip: 198.51.100.7' -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-Ip: 6.6.6.6'
done
check "Cloudflare's IPv6 passes through" 18080 'cf=[2001:db8::7]' -H 'Cf-Connecting-Ip: 2001:db8::7'
check "X-Forwarded-For alone is not a source" 18080 'cf=[127.0.0.1]' -H 'X-Forwarded-For: 198.51.100.8'
check "junk Cf-Connecting-Ip falls back to the peer" 18080 'cf=[127.0.0.1]' -H 'Cf-Connecting-Ip: not-an-ip'
check "other IP headers still stripped" 18080 'real=[] do=[] true=[]' "${forged[@]}"
stop

if [ "$fails" != 0 ]; then
  echo "$fails Caddy client-IP check(s) failed." >&2
  exit 1
fi
echo "Caddy client-IP checks passed."
