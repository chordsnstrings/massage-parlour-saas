#!/usr/bin/env bash
# Claude Code cloud SessionStart hook: install deps, start local Postgres, migrate + seed.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"
[ -f .env ] || cp .env.example .env
pnpm install --frozen-lockfile --prefer-offline >/dev/null
bash scripts/local-db.sh >/dev/null
pnpm db:migrate >/dev/null && pnpm db:seed >/dev/null
echo "session ready: deps installed, Postgres on :5432 migrated + seeded"
