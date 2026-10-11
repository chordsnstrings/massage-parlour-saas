#!/bin/sh
# Creates roles + the spa database; idempotent. Runs on an empty data directory (postgres image entrypoint, socket)
# and on every deploy (compose service db-roles: PGHOST/PGPASSWORD set), so new roles reach existing droplets.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db_name=spa \
  -v owner_password="$SPA_OWNER_PASSWORD" \
  -v platform_password="$SPA_PLATFORM_PASSWORD" \
  -v app_password="$SPA_APP_PASSWORD" \
  -v drill_password="${SPA_DRILL_PASSWORD:-}" \
  -f /bootstrap/bootstrap.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname spa -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
