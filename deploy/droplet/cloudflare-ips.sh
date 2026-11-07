#!/usr/bin/env bash
# F26: compares the Caddyfile's `trusted_proxies static` list with Cloudflare's published edge ranges
# (https://www.cloudflare.com/ips-v4 + ips-v6, the lists behind https://www.cloudflare.com/ips/).
#   cloudflare-ips.sh           exit 1 and show the difference when the Caddyfile is out of date (CI, weekly)
#   cloudflare-ips.sh --write   rewrite the list in place (then commit; the droplet reloads Caddy on deploy)
set -euo pipefail
caddyfile="$(dirname "$0")/Caddyfile"
fetch() { curl -fsS --retry 3 --max-time 20 "https://www.cloudflare.com/$1" | tr -d '\r' | grep -E '^[0-9a-fA-F:.]+/[0-9]+$'; }
v4=$(fetch ips-v4)
v6=$(fetch ips-v6)
[ "$(wc -l <<<"$v4")" -ge 10 ] && [ "$(wc -l <<<"$v6")" -ge 5 ] || { echo "Cloudflare's lists look truncated" >&2; exit 2; }
want=$(printf '%s\n%s\n' "$v4" "$v6" | tr '\n' ' ' | sed 's/ $//')
have=$(grep -E '^\s*trusted_proxies static ' "$caddyfile" | sed -E 's/^\s*trusted_proxies static //')
if [ "$(tr ' ' '\n' <<<"$want" | sort)" = "$(tr ' ' '\n' <<<"$have" | sort)" ]; then
  echo "Caddyfile trusted_proxies match Cloudflare's $(wc -w <<<"$want") ranges."
  exit 0
fi
if [ "${1:-}" = "--write" ]; then
  sed -i -E "s#^(\s*trusted_proxies static ).*#\1${want}#" "$caddyfile"
  echo "Updated $caddyfile; commit it."
  exit 0
fi
echo "::error::deploy/droplet/Caddyfile trusted_proxies differ from Cloudflare's ranges. Run deploy/droplet/cloudflare-ips.sh --write and commit."
diff <(tr ' ' '\n' <<<"$have" | sort) <(tr ' ' '\n' <<<"$want" | sort) || true
exit 1
