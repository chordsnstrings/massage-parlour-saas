#!/usr/bin/env bash
# Local Postgres 16 for dev/tests (no Docker needed). Runs the server as the `postgres` OS user,
# then bootstraps roles and the `spa` (dev) and `spa_test` databases. Idempotent.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${SPA_PGDATA:-/tmp/spa-pgdata}
PORT=${PGPORT:-5432}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$PGDATA"
  as_pg "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8 >/dev/null"
fi
if ! as_pg "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -k /tmp' -l $PGDATA/server.log -w start" >/dev/null
fi
for db in spa spa_test "$@"; do
  PGOPTIONS="-c client_min_messages=warning" psql -h localhost -p "$PORT" -U postgres -d postgres -q \
    -v db_name="$db" -v owner_password=spa_owner_dev -v platform_password=spa_platform_dev -v app_password=spa_app_dev \
    -f "$ROOT/packages/db/sql/bootstrap.sql"
done
echo "Postgres ready on localhost:$PORT (databases: spa spa_test $*)"
