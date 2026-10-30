# spamanagement.co — Claude notes

Multi-tenant SaaS for UAE massage parlours. **Source of truth: `docs/PLAN.md`** — read the relevant section, not the whole file.
Status: P1, P2 and P3 complete (see docs/PLAN.md §14.1–14.2); spa dashboard redesign Phase 1 + 2 ✅ (§14.6), owner requests R1–R30 (§14.8; R28 dynamic HTML designs ✅ 2026-10-13, P0–P6; R29 console Google/Meta keys,
R30 weekly SEO check, Enquiries → Make booking, BE RELAX v2.2 lazy loading ✅ 2026-10-13; R32 booking ↔ sale order + daily sales
sheet PDF ✅ live 2026-10-15, PR #55; R33 crawler text + profile links + per-spa redirects ✅ live 2026-10-18, PR #58;
R36 dashboard bookings + sales + website pop-up ✅ live 2026-10-21, PR #60; R37 worker outage fix ✅ live 2026-10-22, PR #62; R38 international client phones ✅ live 2026-10-22, PR #63);
fix backlog F1–F32 ✅ released 2026-10-10 (PR #22; owner steps after release in §17); production runs on one DO droplet (deploy/droplet: Compose + Caddy, pull-based updates from the branch), live at
https://spamanagement.co since 2026-10-10 (PR #27 + #28; old sslip.io links redirect).

## Code map (details + verified known gaps: `docs/CODEMAP.md` — read it before structural work)
- Packages: `core` (pure helpers: time/business date, slots, permissions, hosts, WhatsApp links) · `db` (schema, RLS,
  `withTenant`) · `auth` · `services` (all DB domain logic; takes the caller's `tx`; no permission/audit checks inside)
  · `ai` (ModelArk gateway + agents) · `apps/web` (every surface) · `apps/worker` (pg-boss jobs). PLAN §4's
  blocks/ui/config packages don't exist: site blocks + UI kit live in `apps/web/src/components/{site,ui}`.
- Write path: `proxy.ts` rewrite → server action → `guard`/`studioGuard` (server/access.ts) → zod → `withTenant(ctx.tenant.id,
  tx => service(tx, …))` → `audit()` → `revalidatePath` → `ok()`/`fail()` (lib/action.ts); `DomainError` → `failDomain`.
- Spa dashboard (PLAN §14.6): `SpaShell` + scoped `crm.css` (super-admin keeps AppShell + globals.css look). UI text
  EN + TH only via `@spa/core/i18n` keys — server `getT()`, client `useT()`; `ok`/`fail` take keys; never translate
  typed names; Thai + Arabic copy natively reviewed by the owner's team 2026-10-09 (new strings still need review).
- Phase 2 screen conversion: page kit `components/crm` + `crm-kit.css`, i18n per-namespace files, enum/permission/
  DomainError translation and the per-screen checklist → `docs/design/phase2-kit.md`.
- Before touching POS/ledger/loyalty/inventory, check CODEMAP "Known gaps" (refund postings, refund side effects, …).
- Plan gating (PLAN §18.8): features `ai` / `marketing` / `multiBranch` only via `@spa/core` plans.ts + `guard(slug, perm, feature)`
  / `FeatureGate` / `entitledSql` — never check plan codes or ids in feature code (CODEMAP "Plans + entitlements").

## Standing owner instructions (2026-10-08)
- **Fix backlog reminder:** PLAN §17: F1–F32 released 2026-10-10, nothing open (owner 2026-10-09: "always remind me"). While any is open,
  remind the owner in one line in the first reply of every session and at the end of every task. Name the open items and
  the next one in order. Don't fix them until the owner says so.
- **SEO agent upgrade reminder (owner 2026-10-17: "dont start the SEO thing till i say so just remind me each time"):**
  R34 (PLAN §14.8) is decided but must not start until the owner says so. Remind in one line in the first reply of
  every session and at the end of every task, next to the fix backlog line.
- **Ask before coding (owner 2026-10-15: "ask me before start coding"):** for a new feature or change request, explain the
  plan and ask the open questions first; code only after the owner's go. Docs/memory upkeep and fixes to Claude's own
  in-flight work are exempt.
- **Keep memory current:** when a decision, structure or verified finding changes, update CLAUDE.md /
  `docs/CODEMAP.md` / `docs/PLAN.md` in the same session, commit, and merge the docs into the deploy branch
  `claude/intelligent-heisenberg-g9e81o` (owner-approved for docs; code still follows the normal review path). The partner may push docs-only commits
  directly too (owner 2026-10-16): pull first, fast-forward only, never force; config/code always via PR.

## Work split (owner, 2026-10-08)
- The Track B partner is stopped: **Claude owns every track** (UI, services, db, worker, auth, deploy). Queue: finish
  PLAN §14.6 Phase 2 → owner requests R1–R15 (PLAN §14.8) → former Track B items B1–B6 (PLAN §14.7).
- **Owner 2026-10-15: the owner's partner codes again alongside Claude.** Start point + state: `docs/HANDOVER.md`
  (keep it current: unmerged branches, open items). Both work on own branches → PRs into the deploy branch; a second
  PR adding a migration regenerates it after merging the base (never renumber by hand).

## Locked decisions (don't re-litigate)
- UAE only: AED, Asia/Dubai (store UTC), EN + AR (RTL) tenant sites.
- Brand name + domain: **spamanagement.co** (owner, 2026-10-08). Everything uses it (copy, auth appName/TOTP issuer,
  `PLATFORM_NAME`/`DEFAULT_EMAIL_FROM` in core/email.ts, env examples); spamanagement.ae is dropped; `EXTRA_ROOT_DOMAINS`
  keeps the old `134-209-145-162.sslip.io` address working (B1; steps: deploy/droplet/README.md "Move to spamanagement.co").
  **The only spamanagement.co email address anywhere (site, legal pages, default sender, ops contacts) is
  `ask@spamanagement.co`** (owner 2026-10-09).
- **Booking ↔ sale = one order (R32, owner 2026-10-14):** fee = `booking_items.price_aed`, planned commission
  (`booking_items.commission_aed`) off the ledger until Finish (`finishBooking` = sale + commission, one tx); corrections
  = void + re-create on the same business date; closed days change only with `pos.correct` (owners/managers, audited,
  close marked amended, stored day-sheet PDF regenerated) — lock the booking's day for fee/commission/details/Finish,
  the sale's day for money; no booking commission for staff not paid per booking (CODEMAP "Booking ↔ sale order").
  Daily sales sheet rules + PDF: CODEMAP "Daily sales sheet".
  Open (owner "ask me later"): how cancelled bookings count — today they are not on the sheet and not sales.
- Payments are **recorded, never processed** (cash / own card terminal / bank transfer). SaaS billing manual + Stripe Checkout for platform invoices only (PLAN §14.3).
- Customer comms = **WhatsApp click-to-send only** (wa.me / web.whatsapp.com / whatsapp:// links). No SMS, no customer email,
  no unofficial WhatsApp automation libraries.
- AI = BytePlus ModelArk, Seed 2.0 family by default; model IDs live in DB config (`ai_model_config`), never hard-coded.
- Integration keys (R29): Google / Meta keys come from the console (Company page) or env, key by key, only via services
  `integrationEnv()` — never `process.env.GOOGLE_*` / `META_*` in feature code. Our own designs' built-in pictures/fonts
  live at `apps/web/public/designs/{design}/{sha256-16}.{ext}` (published designs link them: never rename or delete).
- Infra ≤ USD 50/month: one DO droplet (docker compose: postgres, migrate, web, worker, caddy). DNS at Namecheap (BasicDNS:
  A @ and A * → droplet), no Cloudflare in front (owner 2026-10-10); Caddy issues certificates on demand. Off-site backups:
  DigitalOcean Spaces (recommended). No Redis.
- Price (owner 2026-10-09, PLAN §18.8): **Premium** AED 14,000 setup + 3,000/month; **Standard** AED 9,000 setup + 2,000/month
  (no AI/Instagram automation, no marketing tools, one branch); excl. VAT, VAT optional; existing spas keep AED 24,000/yr
  until renewal; super-admin per-spa discounts + feature-tier override. Manual cash/bank-transfer billing (+ Stripe Checkout).
  Hand-made client invoices (Be Relax = Premium at the Standard price), owner's invoice rules + Word templates: `docs/billing/README.md`.
- Site builder: Puck-based drag & drop, 23 templates (8 classic + 15 from the owner's designs, R5), granular per-device style overrides (PLAN.md §11);
  super-admins can also upload an HTML design shown exactly as built (sandboxed, R17; R24: ≤ 5 MB, stored byte for byte
  as a file, the page JSON only references it — CODEMAP "HTML designs"; PLAN §14.8).
  **HTML designs render exactly as built (owner hard rule 2026-10-11, R24)**: no platform CSS/viewport/fixes unless the
  design's "Phone fixes" switch is on; only invisible changes (embedded files moved to /files, `<base>` in frames,
  placeholders, compat shim, JSON-LD/canonical/t.js, `contract.inline` first-screen pictures as data: URIs inside
  CRM_DATA — owner 2026-10-13 "no delay when I reload", contract doc §10; `contract.inline_fonts` woff2 fonts as
  data: URIs in CRM_DATA `inline_fonts`, declared locale only — owner 2026-10-14 Decision B, contract doc §11; og:*/twitter:* share tags, icon +
  apple-touch-icon links (spa logo) and hreflang links, each only when the design has none — owner 2026-10-14
  Decision A, core `htmlDesignHeadTags`, never `<html lang>`; R33 crawler text: CRM values written into empty `data-crm`
  slots, the `[crm-*]` link hrefs and phones/hours rows, only for designs declaring `contract.prefill: 1`, live page
  only — contract doc §12); the live page is the design document itself (CSP sandbox, never
  allow-same-origin); proof `e2e/html-fidelity.spec.ts` must stay green. Uploads ≤ 5 MB via `/files/templates`.
  **CRM feed for contract designs (R26, 2026-10-12):** a design with `window.CRM_DATA` / `<meta name=crm-endpoint>`
  gets operational keys live from the CRM (only that JSON changes); an empty CRM value or list keeps the design's
  only on the spa's own design (R28 D1: another spa's design shows nothing there; staff: none opted in or no photo →
  none); prices never inherited; booking url stays the design's; its booking form → a
  website enquiry (`{site}/crm-enquiry`, only sites with a live contract design, no automatic booking). Staff on any
  website (Team block too) only with "Show on website" (`docs/design/html-crm-contract.md`).
  **Dynamic HTML designs (R28, owner 2026-10-12):** nothing a visitor sees may be fixed in the file — CRM (live) >
  per-spa website content (draft → publish, EN + AR; Arabic shows in the design's own layout) > design defaults;
  overlays change values only, never layout/CSS/scripts (R24 kept). Plan + phases: `docs/design/r28-dynamic-html-designs.md`.
  D4: a new HTML template version is signed off by its Roll out (live at once, content carried, per-spa undo + hold);
  D5: Write texts queued per switched spa (drafts, never on the spa's own design).
  **Website Studio (R23, 2026-10-10):** lives in the console (Websites → spa page `/websites/{slug}`, full-screen editor);
  super-admins publish directly, no spa review/approve; the spa CRM Website page = services + prices, a preview,
  Request a change. **Write texts** = AI drafts of every page's texts in EN + AR (`SITE_AI_EDITOR_EMAILS` + 2FA, drafts only).
  **Prompt editing** (Studio "Ask AI", Claude or ChatGPT MCP connector `/api/mcp`, R25; R24 adds templates, HTML
  designs get/set/patch and add_image): drafts only (a connector template switch writes the DRAFT theme), no publish
  tool, only `SITE_AI_EDITOR_EMAILS` super-admins with 2FA; production default `*` = every super-admin, same rule as the
  console (a named list also needs a verified email) (owner, 2026-10-11; PLAN §18.2, CODEMAP "AI assistant MCP connector").
- **Spa dashboard** (owner, 2026-10-08): the Be Relax CRM layout (`docs/design/be-relax-crm.html`, spec `docs/design/crm-spec.md`),
  identical for every spa (spa logo + name in the sidebar from onboarding), ~15–20% more compact, light only, EN + Thai
  (all UI text and system messages; typed names never translated). Plan: PLAN §14.6. **Look (owner, 2026-10-09,
  replaces the blue):** the sign-in brand made lighter — DM Sans text, Space Grotesk headings/figures (Thai: Noto Sans
  Thai first), mint/cream light surfaces, dark-green #0F6B4B primary, lime #D9F26A only for small highlights, compact
  sizing kept; small "SM Spa Management" badge at the sidebar foot → marketing site. Tokens only in `crm.css`.
  **PWA:** every spa's CRM installs as its own app named "{first word of spa name} Management", spa logo as icon
  (initials on lime without one). PLAN §18.6.
- Super-admin console + editor chrome: minimal Swedish modern, airy well-padded 12-col grid, one accent,
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
- Owner rules (2026-10-08): no broad file searches/scans unless told (exact paths); never echo large code, minimal diffs only;
  brief direct answers, no filler; one-line summary per finished task.

## Commands
- `bash scripts/local-db.sh` — local Postgres 16 + roles + `spa` (dev) / `spa_test` DBs (SessionStart hook runs it, then migrate + seed).
- `pnpm db:generate` (after schema edits in `packages/db/src/schema`) · `pnpm db:migrate` · `pnpm db:seed`
  · `pnpm db:check-drift` (CI `guards`: fails when a schema edit has no migration)
- `pnpm dev` — web on http://localhost:3000 (marketing), http://app.localhost:3000, http://admin.localhost:3000, http://{slug}.localhost:3000
- `pnpm lint` (Biome) · `pnpm format` · `pnpm typecheck` · `pnpm test` (Vitest; DB tests use `spa_test`)
- `pnpm --filter @spa/web e2e` — Playwright, own dev server on :3100 against `spa_test`. Full suite: build first and run
  with `E2E_SERVER=start` (production server, as CI does) — the dev server's on-demand compiles OOM past ~13 GB.
- Targeted: `pnpm --filter @spa/<pkg> test` · `cd <pkg> && npx tsc --noEmit`
- Super-admin locally: create the login at admin.localhost:3000/join with an email in `PLATFORM_ADMIN_EMAILS` (the
  public /signup is the spa application form and refuses listed emails), verify it (link, or another super-admin's
  Company → Super-admins "Mark email verified"), then enrol 2FA. Production list = droplet base value + the two
  owner-added admins appended in deploy/droplet/compose.yml (`SITE_AI_EDITOR_EMAILS` defaults to `*` there).

## Gotchas
- Biome reformats on `pnpm format`; patch the formatted code (prefer the Edit tool over string-replace scripts).
- The web app loads the root `.env` through `apps/web/scripts/next.mjs` (Next's render workers don't see env set in next.config).
- Server components: read `headers()` (e.g. `getSession()`) before touching DB/auth so pages stay dynamic at build time.
- Links are domain-agnostic (server/origin.ts): `requestUrls()`/`appUrl()`… for getting around (visitor's platform
  domain, from the ROOT_DOMAIN + EXTRA_ROOT_DOMAINS allow-list; unknown hosts → canonical); `canonicalUrls()` for
  addresses that are shared, stored or sent (spa site/`publicSiteUrl`, invites, preview share links, public file URLs).
  Links to a spa's live site always via `publicSiteUrl` (worker: `publicSiteBase`/`spaSiteUrl`): own domain once primary,
  the temporary address 301s there (R20); `.site()` only for the free address itself (CODEMAP URLs).
  Old/extra platform domains' pages 308 to the canonical domain (R29), so OAuth only ever starts there: register
  only the canonical callbacks (`canonicalUrls()`). Next makes a proxy redirect's Location relative when it names its
  own listen address, so e2e binds `-H 0.0.0.0` like production (a local dev with ROOT_DOMAIN=localhost:PORT +
  EXTRA_ROOT_DOMAINS would loop the old-domain → bare canonical redirect); CNAME target = CF_CNAME_TARGET
  (site.env move block: customers.spamanagement.co; unset = APP_URL host); worker jobs use APP_URL.
- `@spa/db` main entry must stay bundle-safe; use `@spa/db/migrate`, `@spa/db/seed`, `@spa/db/testing` subpaths.
- Worker bundle (R37): esbuild single file, banner `createRequire as __workerCreateRequire`, `--external:sharp` (run
  image has no node_modules: no image processing in worker jobs). CI "Worker bundle starts" + update.sh
  `worker_health` guard it; a crash there once went unnoticed 10 days (web stays up, alerts live in the worker).
- `platformDb()` only in platform code paths (auth, super-admin, host lookup, signup, invitations, cross-tenant member lists);
  tenant data always via `withTenant()`. Never import client-module helpers into server components.
- Deploys: the droplet's `spa-update` timer deploys **`deploy/green`** every 2 min and rebuilds: CI's `promote` job moves
  it (forward only) to each commit of the deploy branch **`claude/intelligent-heisenberg-g9e81o`** (also the GitHub
  default) whose checks passed (G7), so every green push there reaches production; `/api/health` shows the release; check
  `https://<host>/_status/deploy.json` (basic auth `ops`). Secrets without SSH: commit `deploy/droplet/secrets.env.enc`
  (see deploy/droplet/README.md). Public deploy settings (domain, routing, ACME email): `deploy/droplet/site.env`
  (applied over the overlay, CI-validated by test-update.sh). A changed update.sh runs from the next deploy on.
  The worker needs `DATABASE_URL_APP` too (tenant-scoped jobs).
- CSP (F10, CODEMAP "Security headers"): every page has a nonce + `'strict-dynamic'` script policy. Our own inline
  `<script>` needs `nonce={await getNonce()}` (server/nonce.ts); a new outside script/frame/font host goes into
  `@spa/core` security-headers.ts; never `srcdoc` for untrusted HTML (inherits the page CSP; use the design shell).
- React effects must use block bodies (`useEffect(() => { … })`): newer Chromium returns a value from `scrollIntoView`,
  which React then calls as the cleanup.
- Tailwind arbitrary classes: no escaped quotes or spaces inside `[…]` (the scanner skips them; percent-encode data URLs),
  and type-hint ambiguous `bg-[…]` (`bg-[position:…]`, `bg-[length:…]`) or `cn()`/tailwind-merge drops the bg colour.
  Arbitrary breakpoints in px (`min-[1440px]:`) sort before the rem theme ones (`md:`) and lose; write them in rem (`min-[90rem]:`).
- CI's Playwright uses Chrome for Testing 153 (headless shell v1243); the local default is Chromium 141. Frame/navigation
  races can show only on CI (R24: an old frame's `document.open()` aborted the reload) — reproduce with
  `/opt/pw-browsers/chromium_headless_shell-1243` via `PW_CHROMIUM` when CI fails but local passes.
- DB unit tests and e2e share `spa_test` and reset it: never run `pnpm test` / a services vitest while an e2e run is going
  (symptom: e2e "no plan", missing rows); take `/tmp/e2e.lock` for both.
- Sandbox-only: Docker builds need the proxy CA (`--build-context ca=/root/.ccr` on a temp Dockerfile copy); committed Dockerfiles stay clean.
