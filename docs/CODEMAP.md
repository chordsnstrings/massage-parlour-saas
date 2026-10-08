# Code map

Where things live and how a request flows. Verified against the code on 2026-10-08 (re-checked at commit `6992d74`).
`docs/PLAN.md` stays the source of truth for product decisions; update this file when the structure changes.

## Workspace (pnpm + Turborepo)

| Package | Role |
|---|---|
| `@spa/core` (packages/core) | Pure helpers, no DB. `booking.ts`: Dubai time, `businessDateOf`/`businessDayWindow` (cutoff default `'05:00'`), `openIntervals`, `findSlots`, `pickStaff`, `newRefCode`, `includedVat`, `BOOKING_TRANSITIONS`. `permissions.ts`: `resource.action` catalogue + `SYSTEM_ROLES` (owner, manager, receptionist, therapist, accountant, content_editor); system roles resolve from code, custom roles from the DB list. `hosts.ts`: `parseRoots`, `matchRoot`, `resolveSurface`. `slug.ts`: `RESERVED_SLUGS`, `checkSlug`. `whatsapp.ts`: `toUaeE164`, `whatsappLink` (desktop/web/mobile). `email.ts`: `sendStaffEmail` (Resend). `report.ts`: Sentry-compatible `reportError`, no SDK. `i18n/` (subpath `@spa/core/i18n`, spa dashboard EN + TH): `en.ts` source catalogue (`en-ui.ts` = UI-kit strings), `th.ts` typed `Messages` (missing key = type error), `translate.ts` (`createTranslator`: dotted keys, `{param}`, `{one,other}` plurals, `t.has`/`t.maybe` for runtime keys), `format.ts` (`createFormat(locale)`: Dubai dates, Thai = `th-TH-u-ca-gregory-nu-latn`, AED stays `AED 1,234`); client code imports the narrow subpaths. |
| `@spa/db` (packages/db) | Drizzle schema (`src/schema/`: auth, platform, tenant, operations, commerce, finance, inventory, growth, site, files), `client.ts` (`platformDb`, `appDb`, `withTenant`), migrations `drizzle/0000–0016` (hand-written SQL inside), `sql/bootstrap.sql` (roles + extensions btree_gist, citext). Subpaths `/migrate`, `/seed`, `/testing`. |
| `@spa/auth` (packages/auth) | Better Auth on `platformDb`: email + password (min 10), TOTP plugin, dynamic `baseURL` (allowed hosts = platform domains, fallback `APP_URL`), rate limits in production only. `user.locale` ('en' | 'th') is an `additionalFields` entry (validated), written via `updateUser`. `./client` for the browser. |
| `@spa/services` (packages/services) | All domain logic that touches the DB. Functions take the caller's `tx: Tx`; services do **not** check permissions or write `audit_log` (callers do). `./site-kit` is client-safe (preflight, contrast, scoped CSS ≤ 4 KB, schedule, Puck tree helpers). |
| `@spa/ai` (packages/ai) | `modelark.ts` (OpenAI-compatible client, no SDK) and `gateway.ts` `runChat`/`runImage`: config from `ai_model_config` by `agentKey` → monthly budget check against `tenants.ai_budget_usd` (Dubai month) → call → zod validation (`json_schema` when `supportsStructuredOutput`, else instructions + 1 retry) → meter `ai_usage`. Agents: `dm` (receptionist chat that books via tools), `instagram` (comment replies, `respondToInstagram`), `content` (IG post, review reply, SEO), `insights` (weekly), `receipt` (OCR: `vision` key, else `dm_agent`), `slots` (slot filler → outbox), `context` (`loadSpaContext`, `SAFETY`). |
| `@spa/web` (apps/web) | Next.js 16; one app serves every surface. |
| `@spa/worker` (apps/worker) | pg-boss 12 on `DATABASE_URL_OWNER`; job registry `src/jobs/index.ts`. |

PLAN §4 lists `packages/blocks`, `packages/ui` and `packages/config`; they don't exist. Site blocks live in
`apps/web/src/components/site`, the admin UI kit in `apps/web/src/components/ui`, and tool config at the root
(`biome.json`, `tsconfig.base.json`, `turbo.json`).

## Database & tenancy

- **Roles** (`sql/bootstrap.sql`, policies in `schema/_rls.ts`):
  - `spa_owner` owns the schema and runs migrations, pg-boss and the worker.
  - `spa_platform` gets policy `platform_all` (every row).
  - `spa_app` gets policy `tenant_isolation`: `tenant_id = current_setting('app.tenant_id')`.
  - No role has BYPASSRLS.
- `withTenant(tenantId, fn)` rejects non-UUIDs, opens a transaction on `appDb()` and runs
  `set_config('app.tenant_id', id, true)`.
- **Platform-only tables** (invisible to `spa_app`): auth tables, `platform_admins`, `platform_settings` (single row),
  `plans`, `ai_model_config`, `push_subscriptions`, `site_templates`. `tenants` adds a `tenant_self` policy so a spa
  sees its own row.
- **Tenant-policy tables in `platform.ts`**: `domains`, `subscriptions`, `platform_invoices`, `platform_payments`,
  `platform_reminders`, `audit_log`, `ai_usage`, `domain_orders`. SaaS billing logic (schedule, mark paid/unpaid,
  reminders, pause/resume/soft delete) = services `platform-billing.ts` (PLAN §14.8 "as built"); `tenants.deleted_at`
  = soft delete (`requireMember` 404s members).
- **DB-enforced invariants**:
  - `reservations` has `EXCLUDE USING gist (resource_kind =, resource_id =, period &&)`. `resource_kind` is
    `staff | room` only (no equipment yet).
  - `shifts` has `EXCLUDE` per staff member over `[starts_at, ends_at)` (migration 0003).
  - Ledger (migration 0005):
    - a one-sided-line CHECK;
    - a deferred constraint trigger that requires balanced entries;
    - an append-only trigger (UPDATE/DELETE raise for `spa_app`);
    - a period-lock trigger (`period_locks.locked_through`).
  - Unique keys: `outbox_booking_kind` (booking_id, kind), `sales_tenant_number`, `bookings_tenant_ref`,
    `site_pages_slug`.
- `packages/db/test/rls.test.ts` checks that RLS is on for every table, that each tenant table has exactly the tenant
  policy, and isolation, platform-table invisibility and tx-local scope.

## Request flow (web)

1. **`src/proxy.ts`** rewrites Host and path to internal route dirs:
   - Host routing: `/marketing` (root, www), `/dashboard` (`app.`), `/platform` (`admin.`), `/site/{slug}`
     (`{slug}.`), `/domain/{host}` (any other host).
   - Path routing (`NEXT_PUBLIC_ROUTING=path`, inlined at build): `/app`, `/admin`, `/s/{slug}`; non-platform hosts
     go to `/domain/{host}`.
   - Sets `x-original-path`. A trailing-dot host gets a 308 redirect.
   - `/api`, `/files`, `_next` and static assets are not rewritten.
2. **`server/session.ts`**: `getSession` reads `headers()` first; `requireUser` redirects to `{surface}/login?next=`.
3. **`server/access.ts`**:
   - `requireMember(slug)`: tenant via `platformDb`, membership via `withTenant`. A platform admin who is not a
     member gets owner permissions and `impersonating: true`. Anyone else gets a 404.
   - `guard(slug, perm)`: permission check plus writable status (trial / active / past_due).
   - `studioGuard` (Website Studio) and `requirePlatformAdmin`.
4. **Server actions** (`app/dashboard/[tenant]/**/actions.ts`, `'use server'`, slug bound on the client):
   - Order: `guard` → zod (`formObject`, `fromZod`) → `withTenant(ctx.tenant.id, tx => service(tx, …))` →
     `audit()` (`server/audit.ts`, platformDb `audit_log`) → `revalidatePath` → `ok()`/`fail()` (`lib/action.ts`).
   - `DomainError` becomes `failDomain(e)` (dashboard; `e.i18n` = catalogue key + params when set); other errors
     rethrow to the error boundary.
   - `ok()`/`fail()` accept plain text or a catalogue key / `{ key, params }`: results keep English `message`/`error`
     plus `key`/`params`, which the client renders in the viewer's language (`resultText`); `fromZod` → `errors.checkFields`.
     `guard`/`studioGuard` errors are translated server-side (`getT`).
   - UI side: `ActionForm` (useTransition, double-submit guard, toasts, field errors — keys translated) and `FormSheet`.
6. **i18n (spa dashboard)**: `i18n/server.ts` `getLocale` (row `user.locale` → `spa_locale` cookie → en; reads the row,
   not the 5-min cached session) / `getT` / `getI18n` (locale, t, fmt, messages); `i18n/client.tsx` `I18nProvider`
   (tenant layout) + `useI18n`/`useT` (outside the provider: English UI-kit strings only); `i18n/actions.ts`
   `setLocaleAction` (updateUser + cookie + `refresh()`). `lib/utils.ts` `formatAed/Date/DateTime` = English `fmt`.
5. **URLs**:
   - `server/origin.ts`: `requestUrls()` uses the visitor's platform domain; `canonicalUrls()` is for anything
     shared, stored or sent.
   - `lib/paths.ts`: `appPath`/`adminPath` for path mode.

## Web routes (`apps/web/src/app`)

- **`dashboard/(auth)`**: login, signup, invite/[token], 2FA, forgot/reset password.
  - Signup calls `provisionTenant`, which creates the tenant, a default branch, the 6 system roles, the owner member
    and a trial subscription on the first active plan. An email listed in `PLATFORM_ADMIN_EMAILS` also becomes a
    platform admin.
- **`dashboard/[tenant]`** (PLAN §14.6): `layout.tsx` renders `.crm` (`lang` = viewer locale) → `I18nProvider` →
  `components/shell/spa-shell.tsx` (sidebar: logo/initials + name + branch line, profile menu, grouped menu, plan card
  with AI meter = month `ai_usage` ÷ `tenants.ai_budget_usd`; top bar: group crumb + title (home = greeting), EN | ไทย;
  ≤860 px drawer). Look = `crm.css` (tokens on `:root:has(.crm)`, lifted under `[data-crm-off]` = site editor/preview
  overlays; UI kit reads `--ui-*` density hooks whose fallbacks are its old sizes). Menu (permission-filtered; items
  with several pages show section tabs under the top bar):
  - Workspace: Dashboard, Calendar, Sales, Inbox & follow-ups (messages · inbox · campaigns).
  - People: Clients, Services & menu (services · packages · inventory), Team & roles (staff · team · documents).
  - Growth: Marketing (ai/content · analytics · AI studio = ai, ai/try), Website studio (website · media), Reviews
    (ai/reviews).
  - Finance: Accounts (P&L, VAT, expenses with receipt scan, journal, export), VAT & payroll (payroll + WPS SIF),
    Billing (Stripe Checkout for platform invoices only).
  - System: Settings (incl. logo, hours, intake, integrations, domains, data).
  - Hidden until Phase 3: Bookings list, Automations, Coming next. Account + switch spa = profile menu.
- **`dashboard/account`** (profile, 2FA, push) and **`dashboard/dev/kit`** (design-system gallery).
- **`platform/(console)`**: overview, tenants, plans, settings, audit, ai models, domains (order approval), templates
  (studio templates), websites (studio overview).
- **`marketing/`**: `/`, features, website-builder, pricing, contact — "C · Bold product-led" look (`marketing.css`,
  scoped `.mkt`; Space Grotesk + DM Sans) + motion (`components/marketing/motion.tsx`: `data-mkt-nav`, `data-rise`,
  `data-tilt` 3D frames, `data-depth` hero parallax, aurora canvas); PLAN §14.3.
- **Public sites**: `site/[slug]` and `domain/[hostname]` render `components/site/public.tsx`, plus `/book`.
- **`files/`**: `/files/{id}` (public = immutable cache; private = members only) and `/files/upload?tenant=`.
- Spa logo: `tenants.logo_file_id` → public `stored_files` (purpose `logo`); services `logo.ts` (`processLogo` 512 px
  WebP, `setTenantLogo`, `clearTenantLogo`, `logoUrl`); uploaded by the signup action (optional, validated before the
  account is created) and Settings (`saveLogoAction`, `intent=remove`); `components/media/logo-input.tsx` shrinks the
  pick in the browser (server actions take ≤ 1 MB). Replaced logo files are kept (URL may be reused).
- **`api/`**:
  - `auth`, `health`, `client-error`.
  - `collect`: analytics beacon; inserts into `web_events` via platformDb.
  - `domains/allowed`: Caddy's on-demand TLS "ask".
  - `integrations/meta|google`: OAuth, Meta webhook, deauthorize, data deletion.

## Site builder

- **Puck config** (`components/site/config.tsx`), 19 blocks:
  - layout: Section, Columns, Stack, Spacer;
  - content: Hero, Heading, RichText, ButtonGroup, Image, Gallery;
  - smart: ServicesMenu, Team, OpeningHours, BookingCTA, WhatsAppButton;
  - more: Testimonials, FAQ, Footer;
  - hidden: GlobalSection.
- **Props**:
  - Content is `{en, ar?}`; AR falls back to EN, and `{name}` becomes the spa name.
  - Style is `{base, md?, lg?}`, compiled to CSS variables (`style.ts`).
  - `advanced` holds the schedule and scoped custom CSS.
- **Themes and templates**: theme tokens in `sites.theme`; 8 built-in templates (`templates.ts`); 24 section presets
  and 7 page templates (`presets.ts`). Studio rows in `site_templates` override built-ins by key.
- **Website Studio gating** (`dashboard/[tenant]/website/page.tsx`):
  - Edit, design and publish need `isStudio` plus the matching permission.
  - The spa can request a change (`site.content`), or approve (`site.publish`) while `studio_status = 'review'`.
  - The editor route 404s for non-studio users.
- **Saving and publishing**:
  - Draft JSON is capped at 512 KB.
  - Design changes need `site.design` (checked via `designSignature`).
  - Preflight runs before publish (`server/site-preflight.ts`); errors block publishing, warnings don't.
- **Share preview**: an HMAC token signed with `BETTER_AUTH_SECRET`, valid for 1, 7 or 30 days, opened at
  `/website/preview?token=` on the app host.
- **Analytics**:
  - `public/t.js` is cookieless. It sends pageviews, a `block_view` when 40% of a block is visible, and
    WhatsApp/Instagram/booking clicks.
  - `/api/collect` caps bodies at 4 KB, allows 240 requests/min per IP and uses a daily-salted session hash.
  - Events land in `web_events`, are rolled up hourly and pruned after 90 days.

## Online booking (`components/booking`)

- **Steps**: service → when (up to 14 days ahead, 60-min lead time) → details (name, UAE phone, honeypot `website`) →
  done (.ics + WhatsApp confirm).
- **`bookOnline`**:
  1. In-memory per-IP limits: 20 attempts/h, 5 bookings/h.
  2. `findOrCreateClient`; blocklisted clients are refused.
  3. `createBooking` with status `pending`, source `online`.
  4. `enqueueBookingMessage`.
  5. Push to the spa via `after(notifyTenant)`.

## Service invariants (`packages/services`)

- **Errors**: `DomainError(message, code)` with codes `slot_taken | not_found | invalid | no_room | no_staff`;
  `pgCode(e)` unwraps drizzle-wrapped errors.
- **Bookings**:
  - Each item inserts one `reservations` row per therapist plus one for the room, covering service time plus
    buffers, inside a savepoint.
  - `23P01` becomes `DomainError('slot_taken')`.
  - Ref code: insert-and-retry on `bookings_tenant_ref` `23505` (up to 5 codes), then `DomainError('invalid')`.
  - Reschedule deletes and re-inserts the reservations; cancel and no-show delete them.
- **Ledger**:
  - `post` only inserts; `reverseSource` posts a mirror entry with source type `<type>_reversal`.
  - `DEFAULT_CHART` codes:

    | Code | Account |
    |---|---|
    | 1000 | Cash |
    | 1010 | Card clearing |
    | 1020 | Bank |
    | 1150 | Staff advances |
    | 1200 | Inventory |
    | 1300 | VAT in |
    | 2000 | VAT out |
    | 2100 | Gift cards |
    | 2110 | Packages/memberships |
    | 2200 | Tips |
    | 2300 | Commissions payable |
    | 2400 | Salaries payable |
    | 3000 | Equity |
    | 4000 | Treatments |
    | 4100 | Retail |
    | 4300 | Breakage |
    | 5000 | COGS |
    | 5100 | Consumables |
    | 6xxx | Expenses |

  - Payment method maps to an account via `PAYMENT_ACCOUNT`.
- **Sales**:
  - The business date comes from the branch cutoff.
  - Void is allowed only on the same open day, with no refunds and nothing prepaid. It reverses the sale,
    commission and COGS entries and returns stock.
  - Refunds are line-level (`refundSale` takes `lines: [{saleLineId, qty}]`; `refundOptions` feeds the sheet).
    Unit amount = share of the line's net paid `line_total_aed`, cumulative rounding in fils; VAT, COGS and
    commission use the same shares. `refund_lines` records each line (prepaid: one row per card/package, `ref_id`).
  - Refund ledger mirrors `postSale` per line (4000/4100 + 2000; 2100/2110 no VAT; credit the method's account),
    plus `refund_cogs` (1200/5000, stock back via `returnSoldStock`) and `refund_commission` (2300/6010, negative
    `commission_entries` on the refund date). Tips stay in 2200.
  - Prepaid lines refund only the unused value (card balance / package remaining value as a share of what was
    paid), then void the card / set the package `refunded`; used-up ones are blocked. Cards/packages carry
    `sale_line_id` (older ones match by sale + definition).
  - The sale row is locked (`FOR UPDATE`) during a refund; it becomes `refunded` when nothing refundable is left.
    The sale total still caps all refunds (pre-F2 amount-only refunds have no lines).
  - `closeDay` runs once per branch and day.
- **Outbox**:
  - EN/AR `DEFAULT_TEMPLATES` or the tenant's own; inserted with `onConflictDoNothing`.
  - Staff open the WhatsApp link, then `markOutbox`.
  - `queueCampaign` takes a row lock plus a per-tenant advisory lock.
- **Secrets**: AES-256-GCM, stored as `v1.<iv>.<tag>.<ct>`. The key is `APP_ENCRYPTION_KEY`, else HKDF from
  `BETTER_AUTH_SECRET`.
- **Storage**:
  - Bytes go in `stored_files.bytes` unless all `S3_*` vars are set; then they go to R2/Spaces under
    `<tenantId>/<fileId>`.
  - `MAX_FILE_BYTES` is 8 MB.
  - Images are re-encoded to WebP q82, longest edge ≤ 2400 px.

## Worker jobs (cron in Asia/Dubai)

| Job | Schedule |
|---|---|
| `db-backup` (pg_dump → R2 when `R2_*` is set) | 03:30 |
| `analytics-rollup` | hourly at :07 |
| `analytics-prune` | 04:20 |
| `packages-expire` | 04:10 |
| `media-prune-ai` | 04:40 |
| `slot-filler` | 10:30, 15:30 |
| `verify-custom-domains` | every 10 min |
| `instagram-publish` | every 5 min |
| `instagram-token-refresh` | 03:40 |
| `gbp-reviews-sync` | every 2 h at :15 |
| `campaigns-housekeeping` | hourly at :15 |
| `document-reminders` | 09:00 |
| `weekly-insights` | Mon 08:00 |
| `daily-digest` | 09:30 |

Integration jobs do nothing until their credentials are configured.

## Deploy, CI, e2e

- **Droplet stack** (`deploy/droplet/compose.yml`):
  - postgres 16 (1200m);
  - `migrate` (worker image: migrate + seed);
  - web (1200m; build arg `NEXT_PUBLIC_ROUTING=${ROUTING:-path}`);
  - worker (512m);
  - caddy: on-demand TLS that asks `/api/domains/allowed`, a 25 MB body cap, and `/_status` behind basic auth.
  - There is no cloudflared in the running stack.
- **`update.sh`**:
  - The systemd timer runs it every 2 minutes. It fetches `BRANCH`, rebuilds on the droplet and health-checks
    `/api/health`.
  - It applies the `secrets.env.enc` overlay (AES-256-CBC, pbkdf2 200k).
- **Deploy branch**: `claude/intelligent-heisenberg-g9e81o` (confirmed by the owner 2026-10-08). It is set as
  `BRANCH` in the droplet secrets and is also the GitHub default branch, so every push to it reaches production
  within about 2 minutes.
- **CI** (`.github/workflows/ci.yml`) runs on PRs and on pushes to `main` and the deploy branch: bootstrap `spa_test` → lint → typecheck →
  test → web build → Playwright e2e.
- **e2e**:
  - Playwright starts its own dev server on :3100 (via `scripts/next.mjs`) against `spa_test`.
  - Settings: workers 1, test timeout 90 s, `PLATFORM_ADMIN_EMAILS=admin@e2e.test`.
  - Host routing by default; set `E2E_ROUTING=path` for path routing.
  - `global-setup` resets the DB and seeds the platform.
  - Helpers sign up owners through the UI; `makeStudio` grants platform admin.

## Known gaps (verified 2026-10-08, not fixed yet)

Check these before touching POS, ledger, loyalty or inventory code. The fix plan, order and open owner decisions are
in **PLAN §17** (items F1–F8 match the numbers below; all fixed).

1. ✅ **Refund postings** (fixed): `ledger.postRefund` now prorates the sale entry's own credit lines. Refunds posted
   before the fix stay as they are (no correcting entries; see the PLAN §17 owner decision).
2. ✅ **Refund side effects** (fixed, F2): refunds are line-level; they return stock, reverse COGS and offset
   commissions for exactly the refunded quantity, and refund only the unused value of prepaid items (then void
   them). Migration 0015 adds `refund_lines` and `sale_line_id` on `gift_cards`/`client_packages`.
3. ✅ **Double checkout** (fixed, F3): `createSale` locks the booking row (`FOR UPDATE`) before the earlier-sale check;
   partial unique index `sales_booking_once` (one non-void sale per booking, migration 0014) backs it up and its
   `23505` maps to a `DomainError`. Migration 0014 skips the index with a WARNING if duplicates already exist.
4. ✅ **Booking ref race** (fixed, F4): `createBooking` inserts inside the savepoint without a pre-check; a
   `bookings_tenant_ref` `23505` retries with a new code (up to 5 attempts), then `DomainError('invalid')`.
5. ✅ **Loyalty cutoff** (fixed, F5): `redeemPackageSession` takes the sale's `businessDate` from `createSale`; otherwise
   it and `expirePackages` use the branch's `business_day_cutoff` (given branch, else the default branch).
6. ✅ **Unreversible stock entries** (fixed, F6): `inventory.move()` returns the `stock_movements` id; `receiveStock`/
   `adjustStock` post with it as `sourceId` (and return it), so `reverseSource` can target them. Older rows unchanged.
7. ✅ **Slot filler DB role** (fixed, F7): `runSlotFiller` finds enabled spas via `platformDb()` and reads per-spa
   `outbox`/`branches` inside `withTenant()`.
8. ✅ **Discounted package liability** (fixed, F8): `issuePackage` takes optional `pricePaidAed` (default list price);
   `createSale` passes each package's share of the line's net `line_total_aed` (cumulative fils rounding). Older
   packages unchanged.
