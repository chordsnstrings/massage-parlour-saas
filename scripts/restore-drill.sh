#!/usr/bin/env bash
# Manual restore drill (PLAN §3.5) — same steps as the worker's monthly `restore-drill` job:
# latest pg_dump from R2 (or a local file) → scratch database → sanity counts → drop.
#   R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY  (same config as db-backup)
#   DATABASE_URL_DRILL  URL of the least-privilege spa_drill role (CREATEDB only, F11), database `postgres`,
#                       e.g. postgres://spa_drill:spa_drill_dev@localhost:5432/postgres (dev); never the superuser
# Usage: scripts/restore-drill.sh [path/to/backup.dump]
set -euo pipefail
ADMIN=${DATABASE_URL_DRILL:?set DATABASE_URL_DRILL (the spa_drill role)}
q() { psql -X -A -t -v ON_ERROR_STOP=1 "$@"; }
# Defence in depth (same rule as the worker): CREATEDB, nothing more.
ATTRS=$(q --dbname="$ADMIN" -c "select rolsuper or rolcreaterole or rolbypassrls or rolreplication, rolcreatedb from pg_roles where rolname = current_user")
[ "$ATTRS" = "f|t" ] || { echo "refusing: the drill role must have CREATEDB and no SUPERUSER/CREATEROLE/BYPASSRLS/REPLICATION" >&2; exit 1; }
WORK=$(mktemp -d)
SCRATCH="spa_restore_drill_$(date +%s)"
SCRATCH_URL=$(printf '%s' "$ADMIN" | sed -E "s#^(postgres(ql)?://[^/]+)/[^?]*#\1/$SCRATCH#")
CREATED=
cleanup() {
  [ -z "$CREATED" ] || q -q --dbname="$ADMIN" -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" || true
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

# Superuser-only extensions (pg_stat_statements) can't be created by spa_drill and hold no data: left out.
SKIP=$(q --dbname="$ADMIN" -c "select string_agg(distinct name, '|') from pg_available_extension_versions where superuser and not trusted")
pg_restore --list "$DUMP" | grep -v -E "^[0-9]+; [0-9]+ [0-9]+ (EXTENSION - |COMMENT - EXTENSION )($SKIP) " > "$WORK/restore.list"
CREATED=1
q -q --dbname="$ADMIN" -c "CREATE DATABASE \"$SCRATCH\""
pg_restore --no-owner --no-acl --exit-on-error --use-list="$WORK/restore.list" --dbname="$SCRATCH_URL" "$DUMP"
for t in tenants user branches clients bookings journal_entries audit_log; do
  printf '%-16s %s\n' "$t" "$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname="$SCRATCH_URL" -c "select count(*) from public.\"$t\"")"
done
MIG=$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname="$SCRATCH_URL" -c 'select count(*) from drizzle.__drizzle_migrations')
printf '%-16s %s\n' migrations "$MIG"
[ "$MIG" -gt 0 ] || { echo "restore drill FAILED: no migrations in the restored copy" >&2; exit 1; }
echo "restore drill OK ($SCRATCH dropped)"
