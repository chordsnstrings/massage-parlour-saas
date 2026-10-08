# spamanagement.ae — Claude notes

Multi-tenant SaaS for UAE massage parlours. **Source of truth: `docs/PLAN.md`** — read the relevant section, not the whole file.
Status: P1, P2 and P3 complete (see docs/PLAN.md §14.1–14.2); production runs on one DO droplet (deploy/droplet: Compose + Caddy, pull-based updates from the branch).

## Code map (details + verified known gaps: `docs/CODEMAP.md` — read it before structural work)
- Packages: `core` (pure helpers: time/business date, slots, permissions, hosts, WhatsApp links) · `db` (schema, RLS,
  `withTenant`) · `auth` · `services` (all DB domain logic; takes the caller's `tx`; no permission/audit checks inside)
  · `ai` (ModelArk gateway + agents) · `apps/web` (every surface) · `apps/worker` (pg-boss jobs). PLAN §4's
  blocks/ui/config packages don't exist: site blocks + UI kit live in `apps/web/src/components/{site,ui}`.
- Write path: `proxy.ts` rewrite → server action → `guard`/`studioGuard` (server/access.ts) → zod → `withTenant(ctx.tenant.id,
  tx => service(tx, …))` → `audit()` → `revalidatePath` → `ok()`/`fail()` (lib/action.ts); `DomainError` → `fail`.
- Before touching POS/ledger/loyalty/inventory, check CODEMAP "Known gaps" (refund postings, refund side effects, …).

## Standing owner instructions (2026-10-08)
- **Fix backlog reminder:** while any item in PLAN §17 (F1–F7) is open, remind the owner in one line in the first
  reply of every session and at the end of every task. Name the open items and the next one in order. Don't fix them
  until the owner says so.
- **Keep memory current:** when a decision, structure or verified finding changes, update CLAUDE.md /
  `docs/CODEMAP.md` / `docs/PLAN.md` in the same session, commit, and merge the docs into the deploy branch
  `claude/intelligent-heisenberg-g9e81o` (owner-approved for docs; code still follows the normal review path).

## Locked decisions (don't re-litigate)
- UAE only: AED, Asia/Dubai (store UTC), EN + AR (RTL) tenant sites.
- Payments are **recorded, never processed** (cash / own card terminal / bank transfer). SaaS billing also manual. Stripe later.
- Customer comms = **WhatsApp click-to-send only** (wa.me / web.whatsapp.com / whatsapp:// links). No SMS, no customer email,
  no unofficial WhatsApp automation libraries.
- AI = BytePlus ModelArk, Seed 2.0 family by default; model IDs live in DB config (`ai_model_config`), never hard-coded.
- Infra ≤ USD 50/month: one DO droplet (docker compose: web, worker, postgres, cloudflared) behind Cloudflare Free. No Redis.
- Price: AED 24,000 per spa per year (manual cash/bank-transfer billing).
- Site builder: Puck-based drag & drop, 8 templates, granular per-device style overrides (PLAN.md §11).
  **Website Studio:** only super-admins edit sites; spas review, approve and request changes (PLAN.md §14.4).
- All admin UI (every role + editor chrome + super-admin): minimal Swedish modern, airy well-padded 12-col grid, one accent,
  micro-animations via `motion`, fully responsive 360 px → wide desktop (PLAN.md §12). Tenant sites fully responsive too.
- Legal/compliance is the operator's responsibility — don't add legal features beyond what PLAN.md lists.

## Stack pins
Next.js 16 (`proxy.ts`, not `middleware.ts`) · Tailwind 4 (logical utilities for RTL) · `@puckeditor/core` ^0.23 (not `@measured/puck`)
· Drizzle 0.45.x (not 1.0 beta) · Better Auth 1.7 · pg-boss 12 · `motion` 14 · Postgres 16 · Node ≥ 22.12.

## Non-negotiable code rules
- Every tenant table has `tenant_id` + RLS. Tenant DB access only through `withTenant()` (transaction-local `set_config`).
  App DB role is not owner and has no BYPASSRLS. Re-check tenant + permission in every Server Function / route handler.
- Bookings reserve resources through `reservations` (EXCLUDE constraint) — never check-then-insert.
- Ledger is append-only; corrections are reversals.
- Business date uses the branch `business_day_cutoff`, not calendar midnight.

## Working preferences (token efficiency — comprehensive results, frugal process)
- After each edit: typecheck + lint + tests for touched packages + the one e2e spec for the touched flow.
- One complete verification (full e2e suite + walkthrough) at phase milestones only. Never re-verify the whole app repeatedly.
- Read only what's needed (grep / line ranges; relevant PLAN.md section only); don't re-read files just edited.
- Parallel tool calls; subagents for broad search/research, keep only conclusions; small workflows only when they clearly pay off.
- Record new decisions here or in `docs/PLAN.md` instead of re-deriving them later. Concise replies.

## Commands
- `bash scripts/local-db.sh` — local Postgres 16 + roles + `spa` (dev) / `spa_test` DBs (SessionStart hook runs it, then migrate + seed).
- `pnpm db:generate` (after schema edits in `packages/db/src/schema`) · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm dev` — web on http://localhost:3000 (marketing), http://app.localhost:3000, http://admin.localhost:3000, http://{slug}.localhost:3000
- `pnpm lint` (Biome) · `pnpm format` · `pnpm typecheck` · `pnpm test` (Vitest; DB tests use `spa_test`)
- `pnpm --filter @spa/web e2e` — Playwright, own dev server on :3100 against `spa_test`
- Targeted: `pnpm --filter @spa/<pkg> test` · `cd <pkg> && npx tsc --noEmit`
- Super-admin locally: sign up with an email in `PLATFORM_ADMIN_EMAILS`, then use admin.localhost:3000.

## Gotchas
- Biome reformats on `pnpm format`; patch the formatted code (prefer the Edit tool over string-replace scripts).
- The web app loads the root `.env` through `apps/web/scripts/next.mjs` (Next's render workers don't see env set in next.config).
- Server components: read `headers()` (e.g. `getSession()`) before touching DB/auth so pages stay dynamic at build time.
- Links are domain-agnostic (server/origin.ts): `requestUrls()`/`appUrl()`… for getting around (visitor's platform
  domain, from the ROOT_DOMAIN + EXTRA_ROOT_DOMAINS allow-list; unknown hosts → canonical); `canonicalUrls()` for
  addresses that are shared, stored or sent (spa site/`publicSiteUrl`, invites, preview share links, public file URLs).
  OAuth runs on the domain it starts on (register each domain's callback); CNAME target + worker jobs use APP_URL.
- `@spa/db` main entry must stay bundle-safe; use `@spa/db/migrate`, `@spa/db/seed`, `@spa/db/testing` subpaths.
- `platformDb()` only in platform code paths (auth, super-admin, host lookup, signup, invitations, cross-tenant member lists);
  tenant data always via `withTenant()`. Never import client-module helpers into server components.
- Deploys: the droplet's `spa-update` timer pulls the deploy branch **`claude/intelligent-heisenberg-g9e81o`** (also the
  GitHub default; every push there reaches production) every 2 min and rebuilds; check
  `https://<host>/_status/deploy.json` (basic auth `ops`). Secrets without SSH: commit `deploy/droplet/secrets.env.enc`
  (see deploy/droplet/README.md). The worker needs `DATABASE_URL_APP` too (tenant-scoped jobs).
- React effects must use block bodies (`useEffect(() => { … })`): newer Chromium returns a value from `scrollIntoView`,
  which React then calls as the cleanup.
- Sandbox-only: Docker builds need the proxy CA (`--build-context ca=/root/.ccr` on a temp Dockerfile copy); committed Dockerfiles stay clean.
