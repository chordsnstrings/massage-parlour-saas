#!/bin/sh
# Runs once, on an empty data directory (postgres image entrypoint). Creates roles + the spa database.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db_name=spa \
  -v owner_password="$SPA_OWNER_PASSWORD" \
  -v platform_password="$SPA_PLATFORM_PASSWORD" \
  -v app_password="$SPA_APP_PASSWORD" \
  -f /bootstrap/bootstrap.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname spa -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
