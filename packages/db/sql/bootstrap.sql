-- Idempotent cluster bootstrap. Run as a superuser with psql variables:
--   db_name, owner_password, platform_password, app_password
-- Roles:
--   spa_owner    owns the schema; runs migrations and pg-boss. Never used by web requests.
--   spa_platform runtime role for platform code (auth, super-admin, host lookup); RLS policy grants it all rows.
--   spa_app      runtime role for tenant data; RLS restricts it to current_setting('app.tenant_id').
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE spa_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spa_owner') \gexec
SELECT format('CREATE ROLE spa_platform LOGIN PASSWORD %L', :'platform_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spa_platform') \gexec
SELECT format('CREATE ROLE spa_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spa_app') \gexec

-- Managed Postgres: the admin user is not a superuser; it must be a member of spa_owner to create its database
-- and set default privileges. Harmless for a real superuser.
GRANT spa_owner TO CURRENT_USER;

SELECT format('CREATE DATABASE %I OWNER spa_owner ENCODING ''UTF8''', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

\connect :db_name
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- global search; migration 0024 also creates it (trusted extension)
GRANT USAGE ON SCHEMA public TO spa_platform, spa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE spa_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spa_platform, spa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE spa_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO spa_platform, spa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE spa_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO spa_platform, spa_app;
