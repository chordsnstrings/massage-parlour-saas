#!/usr/bin/env bash
# F25 schema-drift guard (CI + local): fails when packages/db/src/schema has changes that no committed migration
# covers, i.e. when `pnpm db:generate` would write a new file. drizzle-kit generates into a throwaway copy of
# drizzle/ (DRIZZLE_OUT, read by drizzle.config.ts), so the committed folder is never touched. No database needed.
set -euo pipefail
cd "$(dirname "$0")/.."
# Relative on purpose: drizzle-kit prefixes "./" to `out`, which breaks absolute paths.
tmp=$(mktemp -d .drift-XXXXXX)
trap 'rm -rf "$tmp"' EXIT
cp -R drizzle "$tmp/drizzle"
# drizzle-kit exits 0 even on errors, so only its "No schema changes" line plus an unchanged copy count as a pass.
# stdin closed + timeout: an ambiguous change (rename vs drop + add) makes it prompt, which is drift too.
DRIZZLE_OUT="$tmp/drizzle" timeout 180 pnpm exec drizzle-kit generate </dev/null >"$tmp/log" 2>&1 || true
if grep -q 'No schema changes' "$tmp/log" && diff -rq drizzle "$tmp/drizzle" >/dev/null; then
  echo "Schema matches the committed migrations ($(find drizzle -maxdepth 1 -name '*.sql' | wc -l) files)."
  exit 0
fi
cat "$tmp/log"
diff -rq drizzle "$tmp/drizzle" || true
for f in "$tmp"/drizzle/*.sql; do
  [ -e "drizzle/$(basename "$f")" ] || { echo "--- pnpm db:generate would add $(basename "$f"):"; cat "$f"; echo; }
done
echo "::error::packages/db/src/schema differs from the committed migrations (or drizzle-kit failed). Run pnpm db:generate and commit the migration."
exit 1
