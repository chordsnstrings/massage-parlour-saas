# spamanagement.co

Multi-tenant SaaS for UAE massage parlours and spas. It covers the spa dashboard (bookings, POS, staff, payroll, reports,
daily sales sheet), each spa's public website (site builder + uploaded HTML designs), AI helpers and the super-admin
console. Live at https://spamanagement.co.

**New here? Read [`docs/HANDOVER.md`](docs/HANDOVER.md) first.** It covers current state, open work, access and how releases work.

## Docs map

| File | What it holds |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Locked decisions, code rules, commands, gotchas. Binding for people and Claude alike. |
| [`docs/PLAN.md`](docs/PLAN.md) | Source of truth: product plan, every owner request (R1–R32, §14.8), fix backlog (§17). Read the section you need. |
| [`docs/CODEMAP.md`](docs/CODEMAP.md) | Where the code lives, how pieces connect, verified "Known gaps". Read before structural work. |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Google Business Profile, Meta (Instagram/Facebook), AI provider setup. |
| [`docs/design/`](docs/design) | Dashboard design spec, Phase 2 page kit, HTML design contract, R28 plan, BE RELAX site files. |
| [`deploy/droplet/README.md`](deploy/droplet/README.md) | Production server: Docker Compose + Caddy on one DigitalOcean droplet, updates, secrets, backups. |

## Stack

Next.js 16 · React · Tailwind 4 · Drizzle 0.45 + Postgres 16 (row-level security per spa) · Better Auth 1.7 · pg-boss 12 ·
Puck editor · Vitest + Playwright · Biome · pnpm 10 workspaces · Node ≥ 22.12.

Packages: `packages/core` (pure helpers, i18n), `packages/db` (schema, migrations, RLS), `packages/auth`,
`packages/services` (all domain logic), `packages/ai`, `apps/web` (every web surface), `apps/worker` (background jobs).

## Run it locally

```bash
pnpm install
cp .env.example .env              # local defaults; never commit real secrets
bash scripts/local-db.sh          # Postgres 16 (needs /usr/lib/postgresql/16/bin) + dev and test databases
pnpm db:migrate && pnpm db:seed
pnpm dev                          # http://localhost:3000 (marketing), app.localhost:3000, admin.localhost:3000, {slug}.localhost:3000
```

Checks before every push: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit + DB tests on `spa_test`) and the Playwright spec
for the flow you touched: `pnpm --filter @spa/web e2e <spec>`. More commands and the local super-admin login are in
`CLAUDE.md` → Commands.

## Releases (important)

`claude/intelligent-heisenberg-g9e81o` is the default branch **and the production branch**. Every push to it whose CI
passes (about 25–30 min) is deployed to https://spamanagement.co a few minutes later. Work on your own branch, open a
pull request into it, and merge (squash) only when CI is green. Details are in [`docs/HANDOVER.md`](docs/HANDOVER.md#how-a-change-reaches-production).
