#!/usr/bin/env bash
# Manual restore drill (PLAN §3.5) — same steps as the worker's monthly `restore-drill` job:
# latest pg_dump from R2 (or a local file) → scratch database → sanity counts → drop.
#   R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY  (same config as db-backup)
#   RESTORE_DRILL_ADMIN_URL  postgres URL of a role with CREATEDB (default: DATABASE_URL_OWNER)
# Usage: scripts/restore-drill.sh [path/to/backup.dump]
set -euo pipefail
ADMIN=${RESTORE_DRILL_ADMIN_URL:-${DATABASE_URL_OWNER:?set RESTORE_DRILL_ADMIN_URL or DATABASE_URL_OWNER}}
WORK=$(mktemp -d)
SCRATCH="spa_restore_drill_$(date +%s)"
SCRATCH_URL=$(printf '%s' "$ADMIN" | sed -E "s#^(postgres(ql)?://[^/]+)/[^?]*#\1/$SCRATCH#")
cleanup() {
  psql -X -q -v ON_ERROR_STOP=1 --dbname="$ADMIN" -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "${1:-}" ]; then
  DUMP=$1
else
  : "${R2_ENDPOINT:?R2 is not configured (or pass a dump file)}" "${R2_BUCKET:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
  BASE="${R2_ENDPOINT%/}/$R2_BUCKET"
  SIG=(--fail --silent --show-error --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY")
  KEY=$(curl "${SIG[@]}" "$BASE?list-type=2&prefix=backups/daily/" | grep -o '<Key>[^<]*\.dump</Key>' |
    sed -E 's#</?Key>##g' | sort | tail -n 1)
  [ -n "$KEY" ] || { echo "no backup found in R2 (backups/daily/)" >&2; exit 1; }
  echo "latest backup: $KEY"
  DUMP="$WORK/latest.dump"
  curl "${SIG[@]}" -o "$DUMP" "$BASE/$KEY"
fi

psql -X -q -v ON_ERROR_STOP=1 --dbname="$ADMIN" -c "CREATE DATABASE \"$SCRATCH\""
pg_restore --no-owner --no-acl --exit-on-error --dbname="$SCRATCH_URL" "$DUMP"
for t in tenants user branches clients bookings journal_entries audit_log; do
  printf '%-16s %s\n' "$t" "$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname="$SCRATCH_URL" -c "select count(*) from public.\"$t\"")"
done
MIG=$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname="$SCRATCH_URL" -c 'select count(*) from drizzle.__drizzle_migrations')
printf '%-16s %s\n' migrations "$MIG"
[ "$MIG" -gt 0 ] || { echo "restore drill FAILED: no migrations in the restored copy" >&2; exit 1; }
echo "restore drill OK ($SCRATCH dropped)"
