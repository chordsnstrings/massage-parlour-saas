# Code map

Where things live and how a request flows. Verified against the code on 2026-10-08 (re-checked at commit `6992d74`).
`docs/PLAN.md` stays the source of truth for product decisions; update this file when the structure changes.

## Workspace (pnpm + Turborepo)

| Package | Role |
|---|---|
| `@spa/core` (packages/core) | Pure helpers, no DB. `booking.ts`: Dubai time, `businessDateOf`/`businessDayWindow` (cutoff default `'05:00'`), `openIntervals`, `findSlots`, `pickStaff`, `newRefCode`, `includedVat`, `BOOKING_TRANSITIONS`. `permissions.ts`: `resource.action` catalogue + `SYSTEM_ROLES` (owner, manager, receptionist, therapist, accountant, content_editor); system roles resolve from code, custom roles from the DB list; `clients.phone` only ever for `PHONE_ROLES` (owner, manager, receptionist — stripped from every other role, custom roles can't get it: `roleMayHold`, `CUSTOM_ROLE_PERMISSIONS`); `TWO_FACTOR_POLICY_ROLES` (owner, manager). `hosts.ts`: `parseRoots`, `matchRoot`, `resolveSurface`. `slug.ts`: `RESERVED_SLUGS`, `checkSlug`. `whatsapp.ts`: `toUaeE164`, `whatsappLink` (desktop/web/mobile). `email.ts`: `sendStaffEmail` (Resend; settings from `resolveEmailConfig`: console source registered via `setEmailSettingsSource` (globalThis registry; web instrumentation + worker start), then env; `setEmailTransport` = e2e outbox only). `resend-domains.ts` (R18): `resendDomains(key, {fetch, baseUrl})` (tests only inject; base URL never from env), `setUpSendingDomain`/`checkSendingDomain`, `namecheapHost`, `ResendDomainError` codes. `config-health.ts`: `configChecks`/`configFlags` (presence only, console overview; `TURNSTILE` is web-only, left out of the worker flags). `turnstile.ts` (F9): `turnstileConfig` (both keys or off), `turnstileOnCustomDomains`, `verifyTurnstileToken` (siteverify, fail closed). `attribution.ts` (F13): `webEntrySource` (raw web_events.source), `attributionOf`/`bookingAttribution` → `BOOKING_ATTRIBUTIONS` (= db `booking_attribution` enum); `staffBookingAttribution` = `website` for a staff Website (`online`) booking (createBookingAction; reports `onlineSourceSql`: null + `created_by` → `website`, else `unknown`). `report.ts`: Sentry-compatible `reportError`, no SDK. `i18n/` (subpath `@spa/core/i18n`, spa dashboard EN + TH): `en.ts` source catalogue (`en-ui.ts` = UI-kit strings), `th.ts` typed `Messages` (missing key = type error), `translate.ts` (`createTranslator`: dotted keys, `{param}`, `{one,other}` plurals, `t.has`/`t.maybe` for runtime keys), `format.ts` (`createFormat(locale)`: Dubai dates, Thai = `th-TH-u-ca-gregory-nu-latn`, AED stays `AED 1,234`); client code imports the narrow subpaths. |
| `@spa/core` (packages/core) | Pure helpers, no DB. `booking.ts`: Dubai time, `businessDateOf`/`businessDayWindow` (cutoff default `'05:00'`), `openIntervals`, `findSlots`, `pickStaff`, `newRefCode`, `includedVat`, `BOOKING_TRANSITIONS`. `permissions.ts`: `resource.action` catalogue + `SYSTEM_ROLES` (owner, manager, receptionist, therapist, accountant, content_editor); system roles resolve from code, custom roles from the DB list; `clients.phone` only ever for `PHONE_ROLES` (owner, manager, receptionist — stripped from every other role, custom roles can't get it: `roleMayHold`, `CUSTOM_ROLE_PERMISSIONS`); `TWO_FACTOR_POLICY_ROLES` (owner, manager), `requires2fa(settings)` (missing = on, G23); therapist has `calendar.ownStatus` (G14). `hosts.ts`: `parseRoots`, `matchRoot`, `resolveSurface`. `slug.ts`: `RESERVED_SLUGS`, `checkSlug`. `whatsapp.ts`: `toUaeE164`, `toE164`, `whatsappLink` (desktop/web/mobile), `asciiDigits` (Arabic-Indic/Persian → ASCII; both phone parsers apply it first, `toE164` also drops bidi/zero-width marks, QA M3). `email.ts`: `sendStaffEmail` (Resend). `turnstile.ts` (F9) + `attribution.ts` (F13): see the row above. `client-drafts.ts` (F15): `clientDraftSettings` (defaults for `tenants.settings.clientDrafts`), `CLIENT_DRAFT_LIMITS` (caps), `inQuietHours`/`afterQuietHours` (Dubai). `vouchers.ts` (F15/F16): `VOUCHER_TOKEN`, `voucherPath`, `giftCardInput` (scanned check URL → token, else code), `PARTNER_CODE`/`newPartnerCode`, `posterBookingUrl`. `hosts.ts` `freeSiteUrl(slug, env)` = worker-side free site address (path routing when APP_URL's host is the root); `pathRoutedAddress`/`hostRoutedUrl`/`canonicalScheme` = old path address → host-routed URL (proxy, see Request flow). `report.ts`: Sentry-compatible `reportError`, no SDK. `i18n/` (subpath `@spa/core/i18n`, spa dashboard EN + TH): `en.ts` source catalogue (`en-ui.ts` = UI-kit strings), `th.ts` typed `Messages` (missing key = type error), `translate.ts` (`createTranslator`: dotted keys, `{param}`, `{one,other}` plurals, `t.has`/`t.maybe` for runtime keys), `format.ts` (`createFormat(locale)`: Dubai dates, Thai = `th-TH-u-ca-gregory-nu-latn`, AED stays `AED 1,234`); client code imports the narrow subpaths. |
| `@spa/db` (packages/db) | Drizzle schema (`src/schema/`: auth, platform, tenant, operations, commerce, finance, inventory, growth, site, files), `client.ts` (`platformDb`, `appDb`, `withTenant`; `poolConfig`: idle connections kept 10 min (`POOL_IDLE_MS`) + TCP keepAlive probing after 60 s; `createDb` logs a pool `error` (idle client lost its backend) instead of crashing — pg's 10 s default cost ~100 ms to reconnect after a quiet minute; per process `DB_POOL_MAX` web 10 + 10, worker 4 + 4, pg-boss 3 = 31 of the droplet's `max_connections=60`), migrations `drizzle/0000–0033` (hand-written SQL inside; `runMigrations` refuses a journal entry older than the newest applied row — Drizzle would silently skip it — and `test/migrate.test.ts` checks idx/tag/`when` order + the snapshot prevId chain: a parallel branch merging second deletes its migration and re-runs `pnpm db:generate`), `sql/bootstrap.sql` (roles + extensions btree_gist, citext). Subpaths `/migrate`, `/seed`, `/testing`. |
| `@spa/auth` (packages/auth) | Better Auth on `platformDb`: email + password (min 10), TOTP plugin, dynamic `baseURL` (allowed hosts = platform domains, fallback `APP_URL`), rate limits in production only (per-IP `customRules`, proven by `test/rate-limit.test.ts` in production mode); a password reset signs the login out everywhere (`revokeSessionsOnPasswordReset`). `user.locale` ('en' | 'th') is an `additionalFields` entry (validated), written via `updateUser`. `./client` for the browser. |
| `@spa/services` (packages/services) | All domain logic that touches the DB. Functions take the caller's `tx: Tx`; services do **not** check permissions or write `audit_log` (callers do). `./site-kit` is client-safe (preflight, contrast, scoped CSS ≤ 4 KB, schedule, Puck tree helpers). `./intake-pdf` is server-only (pdfkit, external in next.config; F27 "Intake PDFs" below). |
| `@spa/ai` (packages/ai) | `modelark.ts` (OpenAI-compatible client, no SDK) and `gateway.ts` `runChat`/`runImage`: config from `ai_model_config` by `agentKey` → `assertAiAllowed` (platform + per-spa kill switch `ai_enabled`, monthly budget `tenants.ai_budget_usd`, Dubai month) → call → zod validation (`json_schema` when `supportsStructuredOutput`, else instructions + 1 retry) → meter `ai_usage` → 80 %/100 % bell notification once per month (G18). Aggregation of `ai_usage` lives only in `services/ai-usage.ts` (console AI usage, Performance, dashboard meter). Agents: `dm` (receptionist chat that books via tools), `instagram` (comment replies, `respondToInstagram`), `content` (IG post, review reply, SEO), `insights` (weekly), `receipt` (OCR: `vision` key, else `dm_agent`), `slots` (slot filler → outbox), `context` (`loadSpaContext`, `SAFETY`), `meta` (R7 Meta tools assistant). `tool-loop.ts` `runToolLoop` = the shared OpenAI-style tool loop (local tools + MCP sources, every step through `runChat`, so budget + `ai_usage` per step; the DM agent uses it). `mcp/`: Meta MCP (see "Meta MCP" below). |
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
  - `spa_drill` (F11): LOGIN CREATEDB only, no grants: the worker's restore drill creates/restores/drops its own
    scratch DB. Attributes + password re-applied on every bootstrap run; empty `drill_password` → sha256 of
    `spa_drill:<owner password>` (worker `drillUrl` derives the same). Dev/CI password `spa_drill_dev`.
  - No role has BYPASSRLS. bootstrap.sql runs at first boot (postgres init) **and every deploy** (compose one-shot
    `db-roles`, official postgres image; the only container besides postgres with the superuser password; not a
    dependency of migrate) — add new roles there, idempotently.
- `withTenant(tenantId, fn)` rejects non-UUIDs, opens a transaction on `appDb()` and runs
  `set_config('app.tenant_id', id, true)`.
- **Platform-only tables** (invisible to `spa_app`): auth tables, `platform_admins`, `platform_settings` (single row),
  `plans`, `ai_model_config`, `push_subscriptions`, `site_templates`, `spa_applications` (PLAN §18.3;
  `created_tenant_id`), `rate_limits` (fixed-window counters: services `hitRateLimit`, web `server/rate-limit.ts`
  `withinIpLimit` → services `withinRateLimits` — per-IP limits for public actions Better Auth's HTTP limiter never sees,
  e.g. apply, contact form), `contact_enquiries` (PLAN §18.4; marketing Contact form, services `enquiries.ts`), `tenant_purges` (G12 purge record; its column is
  `purged_tenant_id` because a `tenant_id` column marks an RLS tenant table — db rls test + `tenantTables()`).
  `tenant_slug_history` (F23: old slug PK → `renamed_tenant_id`, `reserved_until`; services `tenant-slug.ts`).
  `tenants` adds a `tenant_self` policy so a spa sees its own row.
- **Data deletion (G12, PLAN §18.2)**: services `data-deletion.ts` — `purgeTenant` (soft-deleted spa only; DELETE
  tenants cascades every `tenant_id` FK — all are ON DELETE CASCADE, keep it that way for new tables), bucket prefix
  delete `deleteTenantObjects` (storage.ts), `autoPurgeDeletedTenants` (worker `tenant-auto-purge`, off unless
  `platform_settings.auto_purge_days`), `eraseClient` (anonymise, keep financial rows; a new client FK in
  `CLIENT_REFERENCES` must also be decided here: keep or delete on erase). Erase deletes the signed intake PDFs
  (`deleteClientIntakePdfs`, file row + bucket object) before the submissions; purge removes them with `stored_files`.
- **F20 tables (`schema/console.ts`)**: `feature_flags` + `announcements` platform-only; `feature_flag_overrides` +
  `announcement_dismissals` tenant tables (cascade on tenant delete). F22 columns: `tenants.billing_stage`
  (`billing_stage` enum) / `billing_overdue_since` / `billing_stage_at`, `platform_settings.billing_overdue_after_days`
  / `billing_grace_days`; F21: `user.last_sign_in_at`. Migration 0042_console_flags_billing_usage.
- **Tenant-policy tables in `platform.ts`**: `domains`, `subscriptions`, `platform_invoices`, `platform_payments`,
  `platform_reminders`, `audit_log`, `ai_usage`, `domain_orders`. SaaS billing logic (schedule, mark paid/unpaid,
  reminders, pause/resume/soft delete) = services `platform-billing.ts` (PLAN §14.8 "as built"); `tenants.deleted_at`
  = soft delete (`requireMember` 404s members).
- **Notifications (B2, migration 0022)**: `notifications` (tenant, `user_id` NULL = everyone holding `permission`,
  `kind`, `payload {params,url}`, partial-unique `dedupe_key`, `read_at` for personal rows) + `notification_reads`
  (per-user read of shared rows). Kinds → permission + text: `@spa/core` `NOTIFICATION_KINDS`/`notificationText`
  (i18n ns `notifications.kind.*`; params `at`/`date`/`amount` formatted in the reader's locale). Services
  `notifications.ts` (`notify` = create deduped → push per recipient locale via `notify.ts`; list/unread/markRead/
  markAll take a `Viewer {userId, permissions}`) + `notification-scans.ts` (producers). Worker
  `jobs/notifications.ts`: pending bookings */15, low stock 09:15 (per location/day), documents 09:00, AI drafts
  10:00, billing overdue/reminders 09:20, prune >90 d 04:50. Web: `NotificationBell` (SpaShell `bell` slot, polls
  60 s), `/[tenant]/notifications`, `server/notifications.ts`. Weekly insights / daily digest (`jobs/engage.ts`)
  write `weekly_insights` / `daily_digest` rows (dedupe per week Monday / business date) via `notify()`.
  **Switches (integration decision):** only producers that ARE an automation respect the B3 switch — document
  expiry (`documentAlerts`, logged to `job_runs` as `document-reminders`). Core alerts (online/pending booking, low
  stock, AI drafts waiting for review, billing) always run. `runNotificationScan(name, scan, now, {key, job})`.
- **DB-enforced invariants**:
  - `reservations` has `EXCLUDE USING gist (resource_kind =, resource_id =, period &&)`. `resource_kind` is
    `staff | room | equipment` (equipment added in migration 0026, B5.3).
  - `time_entries`: unique partial index `time_entries_one_open` (one open clock entry per person) + EXCLUDE
    `time_entries_no_overlap`; `leave_requests`: EXCLUDE `leave_no_overlap` (same person, overlapping dates,
    status ≠ rejected) — all migration 0026 (B5.4).
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
   - F10: sets the page security headers with a fresh nonce (see "Security headers").
   - F23: GET/HEAD for a renamed spa's previous slug (site `{old}.{root}` / `/s/{old}`, dashboard `app/{old}`) →
     301 to the current slug, path + query kept (`server/slug-redirect.ts`: one old→current map per process from
     services `slugRedirects`, 30 s TTL, cleared by the console rename; imports `@spa/services/tenant-slug`, never the
     services barrel). `api/domains/allowed` (Caddy ask) allows the old host too.
   - Host routing only (the move off path routing): an old path-routed address — `/app/…`, `/admin/…`, `/s/{slug}/…` on
     any platform root or its `www.` — → `app.` / `admin.` / `{slug}.` of the canonical root (`ROOT_DOMAIN`), rest of
     the path + query kept, one hop (slug through `currentSlugFor`, so a renamed spa lands on its current slug; the app
     path's first segment too). GET/HEAD 301 (as F23), other methods 308 (keeps method + body);
     `cache-control: private, max-age=300` (a rename or a switch back to path routing applies within minutes). Runs
     before the rewrite/F23/CSP, which stay unchanged. Pure parse/build in core `hosts.ts` (`pathRoutedAddress`:
     null under path routing (`{ pathRouting }`, so the production guard is unit-tested), marketing-surface host +
     `/s/{checkSlug-valid slug}` only; `hostRoutedUrl`: target host = fixed label or that
     validated slug on the canonical root, never other request input; `canonicalScheme` = APP_URL's) →
     `packages/core/test/hosts.test.ts`; e2e `path-redirects.spec` + a host-mode step in `slug-rename.spec`. Never
     redirected (not rewritten, served on every platform host incl. the old one; R20's platform-only 404 aside): `/api/*` (OAuth callbacks, Meta webhook /
     deauthorize / data-deletion, `/api/mcp`, `/api/health`, Caddy ask), `/files/*`, `/.well-known/*`, `_next`, static
     files (`/widget.js`); `/_status/*` is Caddy's (`SITE_HOST`, and the sslip.io fallback). Owner steps:
     deploy/droplet/README.md "Move to spamanagement.co".
   - R20 (own domain only): when a spa has an active **primary** custom domain (not cancelled), every GET/HEAD for its
     site on the temporary address (`{slug}.{any platform root}`, `/s/{slug}` with path routing; an old `/s/{slug}`
     path address under host routing too) → 301 to the same path + query on `https://{domain}`, one hop (a renamed
     slug resolves through `currentSlugFor` first), `cache-control: private, max-age=300`; runs before F23. Kept
     (served as before): other methods (forms/server actions started there), `/book/embed` (widget iframe; snippets
     on other sites point at it), `robots.txt` (the host still serves `/book/embed`, so its Disallow must stay readable
     to crawlers that don't follow a robots.txt redirect; its Sitemap line already names the own domain), and
     `/api` (never rewritten, Caddy ask included; `/api/auth|mcp|integrations` + `/.well-known` reach the proxy only
     for the platform-only check, which returns before any redirect), `/files`, `_next`, `/widget.js`, `/t.js`.
     `sitemap.xml` IS redirected (a sitemap belongs on its URLs' host). R26: `{site}/crm-enquiry` (POST/OPTIONS) is never
     redirected or platform-only (works on the temporary address and the own domain); a GET of `crm-data.json` 301s
     like a page, with `Access-Control-Allow-Origin: *` on the hop. Studio previews live on the console
     (`/websites/{slug}/preview`, R23), the spa's preview + preview-share links on the app host (`/{slug}/website/preview`,
     `/website/preview?token=`), never on the temporary address.
     Pure decisions in core `hosts.ts` (`temporarySitePath`, `keepsTemporaryAddress`, `ownDomainUrl`;
     core/test/hosts.test.ts); lookup `server/own-domain.ts` `ownDomainTarget` (one slug → hostname map per process,
     30 s TTL for the worker's checks; `forgetOwnDomains()` from sites.ts `invalidateSiteHost`/`forgetSiteTenants` and
     the spa "Make primary" action). Pending/failed domains never redirect. The 301 starts only once the own domain
     serves: each map load drops sites.ts host-cache `'missing'` entries (`h:{hostname}`, read via globalThis, no import
     cycle) for its hostnames, and no redirect while one says `'missing'`. e2e `own-domain-redirect.spec`.
   - R20: a custom-domain host never answers platform-only endpoints (core `platformOnlyPath`: `/api/auth`,
     `/api/mcp`, `/api/integrations`, `/.well-known` — extra matcher entries → 404 there, `NextResponse.next()` on
     platform hosts, no rewrite/page headers). Its pages are always `/domain/{host}/…` (no /login, /dashboard, …).
   - F24: sets `x-internal-path` (the rewrite) → `server/surface.ts` `requestSurface()` = surface + document
     lang/dir + home link for the root layout's `<html>` and the status pages.
   - `/api`, `/files`, `_next` and static assets are not rewritten (so `/og/{page}.png` reaches `app/og/[page]`).
     `/robots.txt` + `/sitemap.xml` ARE rewritten, so each surface answers its own (F12, see "Search + social").
2. **`server/session.ts`**: `getSession` reads `headers()` first; `requireUser` redirects to `{surface}/login?next=`.
   - `/api`, `/files`, `_next` and static assets are not rewritten.
2. **`server/session.ts`**: `getSession` reads `headers()` first, then confirms the session row still exists and the
   login isn't disabled (the 5-minute cookie cache would otherwise keep a revoked session alive); `requireUser`
   redirects to `{surface}/login?next=`.
3. **`server/access.ts`**:
   - `requireMember(slug)`: tenant via `platformDb`, membership via `withTenant`. A platform admin who is not a
     member gets owner permissions and `impersonating: true`. Anyone else gets a 404.
   - `guard(slug, perm)`: permission check plus writable status (trial / active / past_due).
   - `studioGuard` (Website Studio) and `requirePlatformAdmin`.
   - G3: super-admin powers (`isPlatformAdmin`, impersonation, console) need TOTP 2FA on (fresh DB read). Without it
     the console/impersonation redirect to the account page on the current host with `?admin2fa=1`
     (`platform/account` re-exports `dashboard/account`, outside `(console)`, so enrolment + sign-out stay reachable).
4. **Server actions** (`app/dashboard/[tenant]/**/actions.ts`, `'use server'`, slug bound on the client):
   - Order: `guard` → zod (`formObject`, `fromZod`) → `withTenant(ctx.tenant.id, tx => service(tx, …))` →
     `audit()` (`server/audit.ts`, platformDb `audit_log`; request IP (core `clientIpFrom`) unless `ip` is passed — `null` for public events like an enquiry) → `revalidatePath` → `ok()`/`fail()` (`lib/action.ts`).
   - `DomainError` becomes `failDomain(e)` (dashboard; `e.i18n` = catalogue key + params when set); other errors
     rethrow to the error boundary.
   - `ok()`/`fail()` accept plain text or a catalogue key / `{ key, params }`: results keep English `message`/`error`
     plus `key`/`params`, which the client renders in the viewer's language (`resultText`); `fromZod` → `errors.checkFields`.
     `guard` errors are translated server-side (`getT`); `studioGuard` (and `guard(…, { english: true })` in the console)
     answers in English, since the console is English only.
   - UI side: `ActionForm` (useTransition, double-submit guard, toasts, field errors — keys translated) and `FormSheet`.
6. **i18n (spa dashboard)**: `i18n/server.ts` `getLocale` (row `user.locale` → `spa_locale` cookie → en; reads the row,
   not the 5-min cached session) / `getT` / `getI18n` (locale, t, fmt, messages); `i18n/client.tsx` `I18nProvider`
   (tenant layout) + `useI18n`/`useT` (outside the provider: English UI-kit strings only); `i18n/actions.ts`
   `setLocaleAction` (updateUser + cookie + `refresh()`). `lib/utils.ts` `formatAed/Date/DateTime` = English `fmt`.
5. **URLs**:
   - `server/origin.ts`: `requestUrls()` uses the visitor's platform domain; `canonicalUrls()` is for anything
     shared, stored or sent. Links to a spa's site that are shown or sent use `publicSiteUrl` (sites.ts; services
     `publicSiteBase`/`spaSiteUrl` in the worker) — own domain once primary (R20), so we never link to a redirect;
     `canonicalUrls().site()` only where the free address itself is meant (Domains page, rename, applications,
     `/files` origins). Platform domains = `ROOT_DOMAIN` (canonical, spamanagement.co) + `EXTRA_ROOT_DOMAINS`
     (production: the old `134-209-145-162.sslip.io`); droplet `APP_URL`/`ADMIN_URL`/`ROUTING` come from site.env.
     R29: GET/HEAD pages on an extra domain 308 to the same surface on the canonical root (`proxy.ts` +
     core `extraRootAddress`/`canonicalAddressUrl`; a spa's free address → own domain / current slug, one hop);
     POSTs, platform-only paths (`/api/auth|mcp|integrations`, `/.well-known`), `/api`, `/files` stay served there.
     OAuth redirect URIs (Google, Meta) are therefore built from `canonicalUrls()` only (connect actions, callbacks'
     code exchange, console + spa cards). e2e `path-redirects.spec.ts` (R29 test), `platform-domains.spec.ts`; the e2e
     server binds `-H 0.0.0.0` (production-like) since Next relativizes a Location naming its own listen address.
   - `lib/paths.ts`: `appPath`/`adminPath` for path mode.

## Web routes (`apps/web/src/app`)

- **`dashboard/(auth)`**: login, signup, invite/[token], 2FA, forgot/reset password.
  - Signup = **spa application** (PLAN §18.3): `signup/actions.ts` creates the login (Better Auth) + a pending
    `spa_applications` row (`submitApplication`); `/application` is the applicant's waiting page (locked logins:
    `server/applications.ts` `applicantState`). The console accepts (`acceptApplication` → `provisionTenantTx` in
    services/applications.ts: tenant, default branch, the 6 system roles, owner member, active subscription, logo,
    setup invoice (VAT optional: `createPlatformInvoice({ vat })` / `invoiceTotals(…, chargeVat)`; due date
    `setupBalanceDueDate` = start or start + 10 days, never before today) + `recordPlatformPayment`, then the plan's
    schedule from the start date via `generateBillingScheduleTx` = the console button's code, so the button later
    creates nothing; deposit bounds/wording `depositRule` + due choices in `@spa/core` `setup-fee.ts`, shared with the
    Accept dialog) or rejects (`rejectApplication`: `user.disabled_at`, sessions deleted; Better
    Auth session hook + `getSession` refuse disabled logins). `provisionTenant` without `subscription` = old trial path. An email listed in `PLATFORM_ADMIN_EMAILS` becomes a
    platform admin only once **verified** (G2: `grantListedPlatformAdmins` in `@spa/db` — used by provision, seed and
    `requirePlatformAdmin`; never demotes). Sign-up sends a verification email (`emailVerification.sendOnSignUp`,
    sign-in not gated; Google sign-ins arrive verified). `sendStaffEmail` throws in production without `RESEND_API_KEY`.
  - **Super-admin join** (owner, 2026-10-09): listed emails never apply (`submitApplication` + `signupAction` refuse
    them, before any login is created); they join on the admin host `platform/(auth)/join` (Better Auth sign-up, no
    spa; `assertAdminJoinAllowed` = neutral refusal; per-IP limit; callback = console). Unverified listed login →
    `requirePlatformAdmin` redirects to `/join` (how to finish + resend). `applicantState.listedAdmin`: never
    `locked`; dashboard home / `/application` / `/signup` send listed or super-admin logins without a spa to the
    console (`adminUrl()`). Console Company → **Super-admins** card (`superAdminRoster`, `markListedAdminVerified` in
    services/platform-admins.ts: listed + not disabled + actor super-admin with 2FA + not yourself; audit
    `platform.admin.email_verified`; no removal). `listedAdminEmails` drops empty segments/duplicates (compose appends).
- **`dashboard/[tenant]`** (PLAN §14.6): `layout.tsx` renders `.crm` (`lang` = viewer locale) → `I18nProvider` →
  `components/shell/spa-shell.tsx` (sidebar: logo/initials + name + branch line, profile menu, grouped menu, plan card
  with AI meter = month `ai_usage` ÷ `tenants.ai_budget_usd`, platform badge `Logo` → marketing site (PLAN §18.6); top bar: group crumb + title (home = greeting), EN | ไทย;
  ≤860 px drawer). Look = `crm.css` (tokens on `:root:has(.crm)`, lifted under `[data-crm-off]` = site editor/preview
  overlays; UI kit reads `--ui-*` density hooks whose fallbacks are its old sizes). Menu (permission-filtered; items
  with several pages show section tabs under the top bar):
  - Workspace: Dashboard, Calendar, Sales, Inbox & follow-ups (messages · inbox · campaigns · enquiries — F15,
    `clients.view`).
  - People: Clients, Services & menu (services · packages · inventory · purchases · warehouse), Team & roles (staff · timeclock · team · documents).
  - Growth: Marketing (ai/content · analytics · AI studio = ai, ai/try), Website studio (website · media), Reviews
    (ai/reviews).
  - Finance: Reports (F31, below), Accounts (P&L, VAT, expenses with receipt scan, journal, export), VAT & payroll
    (payroll + WPS SIF), Billing (Stripe Checkout for platform invoices only).
  - System: Settings (incl. logo, hours, intake, integrations, domains, data).
  - Not in the menu (X6): `waitlist` (linked from the Calendar + Bookings headers) and `clients/duplicates`
    (Clients header "Duplicates", needs `clients.merge`; `?keep=&merge=` = preview + merge).
  - Hidden until Phase 3: Bookings list, Automations, Coming next. Account + switch spa = profile menu.
  - Nav count badges: `ShellItem.count` ← `server/nav-counts.ts` (`navBadgeCounts`, React cache) ← services
    `calendar.ts` `navCounts` (one query): Calendar today, Bookings pending today, Inbox = due outbox + unread IG
    + new website enquiries (`enquiriesNew`, F15).
  - **Reports (F31)** `reports/` (`reports.view`; RevPATH card also `dashboard.revenue`, liability `accounting.view`):
    `data.ts` `loadReports` (branch scoping as on Home, `performanceRange` keys 7/30/90/month/last-month, today =
    business date at the branch cutoff, `?rebook=30|60|90`, `?asOf=` ≤ today) → services `kpi-reports.ts`, one query
    per KPI: `rebookingRate` (completed visits with a client; rebooked = another non-cancelled booking starting later,
    business date ≤ visit + N; per therapist via `booking_items.staff_ids`; `pending` = window still open),
    `retentionCohorts` (12 months ending at the period month; cohort = first completed visit in scope, whole spa also
    `clients.first_visit_at` at the cutoff so imports stay in old cohorts; +1…+6 months, null = not started),
    `revPath` (ex-VAT service lines of paid|refunded sales + package/membership session values matched to the 0-priced
    line's therapist − service `refund_lines` by refund date ÷ bookable staff hours: shifts clipped to the business-day
    window, else time entries; reception = not bookable), `roomUtilisation` (booked `duration_min` of bookings not
    cancelled/no-show ÷ `openIntervals` × rooms; inactive rooms only when used), `prepaidLiability(asOf)` (spa-wide,
    rebuilt from movements: gift-card txns by sale / refund / cutoff date; packages + memberships = price − redemptions,
    0 from the refund line or `package_expiry`/`membership_expiry` entry date; vs ledger 2100/2110 credit − debit,
    `difference` = ledger − items). `export/route.ts` = .xlsx (R10), one sheet per KPI, viewer's language.
    Console Performance detail adds `tenantOperations` (whole-spa aggregates only). Migration 0038_kpi_indexes: indexes
    `booking_items_booking`, `shifts_branch_time`.
    `calendar.ts` `navCounts` (one query): Calendar today, Bookings pending today, Inbox = due outbox + unread IG;
    `outboxMine` (F28) = due messages assigned to the viewer → second, dark-green Inbox badge (`ShellItem.mine`).
  - Calendar ranges: `calendar/page.tsx` `?range=week|month` → `loadCalendarSpan` (data.ts) → services
    `loadCalendarRange` → `components/calendar/span-view.tsx`; Day view takes `?open=<bookingId>` (PLAN §14.6 Phase 3).
  - Top bar global search (`components/search`: `searchAction` + `SearchPalette`, ⌘K/Ctrl+K; PLAN §14.9).
  - Settings → Security: require-2FA toggle (`saveSecurityAction`; on by default, G23), recent audit rows;
    Settings → Online booking: auto-confirm returning clients (`saveOnlineBookingAction`, G21 → `selfBookingStatus`).
  - Therapist (G14): booking sheet own-status buttons → `setOwnStatusAction` (calendar/actions.ts) → services
    `setOwnBookingStatus` (ownership check); TherapistHome "My earnings" → `staffEarnings` (payroll.ts).
    `settings/audit` = audit log viewer (`audit.view`).
  - Installable app per spa (PLAN §18.6): `app.webmanifest/route.ts` + `app-icon/[key]/[variant]/route.ts` (public,
    cookie-free; `server/pwa.ts` = name rule via core `pwaAppName`, icon key = hash(ICON_VERSION + logo file id |
    initials), 30 s slug cache; `server/pwa-icons.tsx` = sharp logo tiles / next/og initials, in-memory LRU). Layout
    `generateMetadata` links them (+ apple title, theme colour); `components/pwa` registers `public/sw.js` (scope `/`,
    shared with push via `lib/sw.ts`; answers every in-scope page load with the preload response — never return early
    for a navigation, or it is fetched twice), stores the localised offline page, "Install app" menu item + tip.
- **`dashboard/account`** (profile, 2FA, push) (`?require2fa=<slug>` notice from the 2FA policy) and **`dashboard/dev/kit`** (design-system gallery).
- **Console tools (F20–F22, PLAN §17)**: `platform/(console)/flags` (feature flags: services `feature-flags.ts`, core
  `flags.ts` `FEATURE_FLAGS` = keys code may read; web `server/flags.ts` `flag(key, tenantId)`), `announcements`
  (services `announcements.ts`; spa side `server/announcements.ts` `announcementsFor` (platform read, plan code from
  entitlements) → `components/shell/announcements.tsx` in the SpaShell banner slot, dismiss =
  `dashboard/[tenant]/announcements/actions.ts` (requireMember, not guard; `announcement_dismissals` via withTenant)),
  Spas list = services `tenant-usage.ts` `tenantUsageList` (one query, sortable; also returns `featureTier` +
  `planTier`) → `platform/(console)/tenants/page.tsx` + page-scoped `tenants.css` (own table, not DataTable: merged
  columns Spa | Activity | Usage | AI | Plan with one header sort link per key, container query on the card:
  ≥ 880 px 6 cols, 660–879 compact with Plan in the Spa cell, < 660 a `<ul>` of cards; no overflow-x by
  construction, e2e `console-spa-list.spec`), billing transitions =
  `billing-actions.ts` (rules card on Company, per-spa pause + Check now on the spa page) → services
  `billing-transitions.ts`; payment paths (`setInvoicePaid`, `recordPlatformPayment` → `.billing`,
  `settleCheckoutSession`) call `liftBillingHold` in their tx and `billingTransitionEffects` after commit. Tenant
  layout banners: `tenants.billing_stage` overdue/grace → red "read-only on {date}" bar, read_only → read-only notice.
- **`platform/(console)`**: overview, applications (PLAN §18.3), enquiries (PLAN §18.4: list/search/filter, detail with
  tel/wa.me/mailto, status + note via `updateEnquiry`; nav badge = `newEnquiryCount`), tenants, plans, settings, audit,
  ai models, domains (order approval), templates
  (studio templates), websites (R23 Website Studio: list + `websites/[slug]` spa page; editor + draft preview full
  screen in the `platform/(studio)` group, layout `requirePlatformAdmin`, no console shell), performance (PLAN §18.1: `performance/data.ts` loops tenants via
  `platformDb()` and reads each spa in its own `withTenant()` — one query per spa from `services/src/performance.ts`
  `tenantPerformance`; detail adds `tenantPerformanceDetail` + F31 `tenantOperations`). Revenue there = sales (paid|refunded) by sale business
  date − `refunds` by refund business date; web numbers from `web_events` (90-day retention → range cap 92 days).
- **`marketing/`**: `/`, features, crm, website-builder, pricing, contact — "C · Bold product-led" look (`marketing.css`,
  scoped `.mkt`; Space Grotesk + DM Sans; Noto Sans Thai as the Thai-glyph fallback in `--font`/`--head`) + motion (`components/marketing/motion.tsx`: `data-mkt-nav`, `data-rise`,
  `data-tilt` 3D frames, `data-depth` hero parallax, aurora canvas); PLAN §14.3. `/crm` EN/TH demo: labels resolved
  server-side from the dashboard catalogues (`components/marketing/crm-demo-copy.ts`) → client `crm-demo.tsx`; PLAN §18.5.
  Home CRM showcase = `crm-showcase.tsx` (same mock, `overview`, + 4 floating cards): CSS scroll-driven 3D
  (`.mkt-show*` in marketing.css; timelines on untransformed wrappers, unitless `--show-*` amounts the JS fallback
  reads) — keep it out of MarketingMotion (no `data-tilt`/`data-rise` inside); PLAN §18.8.
  Plan cards = `components/marketing/plan-cards.tsx`, one server component for home (`compact`) + /pricing (`full`):
  `activePlans()` rows (pricing keeps `FALLBACK_PLANS` for a DB-less build), Premium/Standard via `planTier`, lists
  from `PLAN_FEATURES`/`FEATURE_LABELS`, `formatAed` split at its NBSP; `.mkt-plans`/`.mkt-pc*` use a row subgrid from
  768px (never put containment on `.mkt-pc` — it stops being a subgrid; the price row is the cqi container) and the
  Premium raise is margin + padding, not a transform (`data-rise="card"` owns transform). /pricing keeps one
  `signup?plan=` link per plan (applications.spec), so none in the comparison header.
  Each list ends on a `.mkt-pl-end` link row pinned to the foot of the shared row (`margin-top: auto`), so the cards end
  level whatever the wrapping; CTAs wrap (DB names). Marketing focus ring = `.mkt :focus-visible` in marketing.css
  (accent, lime on `.mkt-dark`/`.mkt-demo`/`.mkt-pc-spot`) — globals.css's ring uses the app's `:root` accent.
  `.mkt-link:hover` turns links `--accent-hover` (dark green), so the Premium card overrides it to white
  (`.mkt-pc-spot .mkt-link:hover`); don't redefine `--accent-hover` there (the card shadow uses it). Two-sentence
  headings: `<br />` + the second sentence in `.mkt-plx-2` (inline-block on the /pricing h1 so phones still balance it).
  Contact = enquiry form (`components/marketing/enquiry-form.tsx` → `contact/actions.ts`: honeypot, `enquirySchema`,
  `withinIpLimit`, Turnstile (F9), `submitEnquiry`, `after()` → `server/enquiries.ts` `emailNewEnquiry`, reply-to = sender) + cards;
  email = console company email or `PLATFORM_CONTACT_EMAIL` (ask@spamanagement.co, core email.ts). PLAN §18.4.
  Footer = brand + 5 link columns into
  section `id`s (features/website-builder/pricing; keep them stable, platform-domains.spec checks them), PLAN §18.5.
- **Public sites**: `site/[slug]` and `domain/[hostname]` render `components/site/public.tsx`, plus `/book`.
- **Status pages (F24)**: root `not-found.tsx` (server, per surface via `requestSurface()`), `error.tsx` (client,
  `SurfaceProvider` context from the root layout → `errorCopy`), `global-error.tsx` (no layout: surface guessed from
  `<html data-surface>` / host / path), all through `components/status/status-page.tsx` + `status.css` (looks `crm`,
  `marketing`, `console`, `site`; self-contained so they render when a surface layout failed). The spa shell keeps
  its own `[tenant]/not-found.tsx` (unknown paths via `[tenant]/[...missing]`) and `[tenant]/error.tsx`. Copy:
  dashboard `errors.page.*` / `errors.boundary.*` (EN/TH), sites `components/site/i18n.ts` (EN/AR). Only the
  digest is shown. `<html lang/dir>`: marketing + console en, dashboard `getLocale()`, sites `?lang=ar` → ar/rtl.
- **Slug rename (F23)**: console spa page "Web address" → `renameSlugAction` → services `renameTenantSlug` (checks as
  Apply + `claimSlugTx`; `provisionTenantTx` claims too; `slugStatus` adds `previous`) → audit
  `platform.tenant.slug_renamed` → clears the redirect map, `resolveSiteTenant` cache, the R20 own-domain map and PWA
  slug caches (globalThis-backed so the action reaches the bundles that read them).
- **`files/`**: `/files/{id}` (public = immutable cache; private = active members with the purpose's permission —
  receipt: accounting, staff/business document: staff.manage, `intake_pdf`: clients.view — under requireMember's rules (deleted spa closed,
  "Require 2FA"), or super-admins with 2FA; anything else 404; no signed URLs) and `/files/upload?tenant=` (images:
  `site.content`, `services.manage` or `staff.manage` via `guardAny(IMAGE_UPLOAD_PERMISSIONS)` — the media picker's
  `listMediaAction` too, so the CRM service/therapist photo pickers work (R28); `kind=video`: `site.design`).
  e2e matrix: `files-access.spec.ts`.
- Spa logo: `tenants.logo_file_id` → public `stored_files` (purpose `logo`); services `logo.ts` (`processLogo` 512 px
  WebP, `setTenantLogo`, `clearTenantLogo`, `logoUrl`); kept on the application at sign-up (optional, validated before
  the account is created; stored as the spa's logo on acceptance) and Settings (`saveLogoAction`, `intent=remove`); `components/media/logo-input.tsx` shrinks the
  pick in the browser (server actions take ≤ 1 MB). Replaced logo files are kept (URL may be reused).
- **`api/`**:
  - `auth`, `health`, `client-error`.
  - `collect`: analytics beacon; inserts into `web_events` via platformDb.
  - `domains/allowed`: Caddy's on-demand TLS "ask".
  - `integrations/meta|google`: OAuth, Meta webhook, deauthorize, data deletion.
  - `mcp/meta`: first-party Meta MCP server (R7, `handleMetaMcpRequest`; bearer = 5-minute signed tenant token).

## Search + social (F12, PLAN §17)

- Pure builders in `@spa/core` `seo.ts` (tests: core/test/seo.test.ts): `jsonLdString` (escapes `< > &` U+2028/9 —
  always use it for inline JSON-LD), `spaJsonLd` (DaySpa + branch address/emirate, geo from a Maps link that carries
  coordinates, hasMap, hours → OpeningHoursSpecification, priceRange, sameAs, services as Offers — prices only where
  `publicPrice` shows them and > 0 (`money()` skips ≤ 0: never "AED 0"); one Offer per treatment name (`crmName`
  identity, like html-crm `collapseSameName`: every length once at its lowest price); BreadcrumbList on inner pages),
  `platformJsonLd`, `robotsTxt`, `sitemapXml`.
- Public prices: services `publicPrice(priceAed, showPrice, spaHides)` is the only gate for every public price
  (websiteServices → blocks / JSON-LD / CRM feed, online booking + its confirmation): null = "price on request" when
  hidden (R4) or not > 0 (QA M6, 2026-10-14). Public AI agents apply the same rule in `ai` agents/context.ts, the website copywriter facts in site-edit.ts `loadSiteFacts`.
- Spa sites: `server/seo.ts` `siteSeo(tenant)` (React-cached): canonical base = `publicSiteUrl` (primary active custom
  domain, else free address), logo/Instagram, published pages, `indexable` = not suspended and ≥ 1 published page.
  Routes `site/[slug]/{robots.txt,sitemap.xml}` + `domain/[hostname]/…`; robots disallow `/book/embed`, `/api/`.
  Not indexable → robots without Sitemap, empty sitemap, pages `noindex` (crawlable, so search drops them).
  `publicSiteMetadata` / `bookingMetadata`: canonical + hreflang (`?lang=ar` when the site has `ar`), og/twitter image
  = first Hero (or band background) image, else the logo. `PublicSite` renders the JSON-LD script.
- Platform: `marketing/{robots.txt,sitemap.xml}` (path routing: also Disallow `/app/ /admin/ /s/*/book/embed` and a
  Sitemap line per `/s/{slug}` spa without a primary custom domain); `dashboard|platform/robots.txt` = disallow all.
  Marketing pages use `marketingMetadata(key, …)` (`components/marketing/seo.ts`, `MARKETING_PAGES` = sitemap list +
  OG headlines); the marketing layout sets `metadataBase` (canonical domain) and the Organization/WebSite/
  SoftwareApplication JSON-LD. OG images: `app/og/[page]/route.tsx` (`next/og`, default font).
- **Weekly SEO check (R30):** core `seo-check.ts` `seoCheck` (pure, linear scans; high = missing title / description /
  not in sitemap, medium = length, duplicates, missing alt; Arabic findings only where the AR page has its own text;
  HTML designs: page texts over the file's `<title>` / meta description; framed designs: page metadata) + shared
  `siteIndexable` (`seo.ts`, also sitemap.xml). Services `seo-check.ts` `runSeoCheck(tx, tenantId, trigger)` /
  `latestSeoCheck` → `seo_checks` (RLS, latest 8 per site). Worker `seo-check` (Mon 06:00 Dubai; `seo_agent` on +
  `entitledSql('ai')` + published site; per-spa errors logged). Console `websites/[slug]` SEO card + `seo-actions.ts`
  (Check now, Draft fixes = Write texts `scope: 'seo'`: `textSlots`/`htmlTextSlots` search fields only incl. root
  title/description where an HTML design falls back to them, `SiteTextRun.scope`). Spa AI studio summary line
  (`ai.seoCheck*` keys).

## Google + Meta integrations (F17–F19, Premium)

- **Keys (R29):** console Company page cards (`settings/integration-keys-card.tsx`, saves `saveGoogleKeysAction` /
  `saveMetaKeysAction` in `(console)/actions.ts`, super-admin + 2FA, audit key names only) → `platform_settings`
  (plain ids; secrets `*_enc` + `*_last4`). **Never read `process.env.GOOGLE_*` / `META_*` directly:** services
  `integration-settings.ts` `integrationEnv()` = env with each saved console key on top (key by key, 30 s cache,
  `invalidateIntegrationEnv()` on save), passed to the pure `googleConfig(env)` / `metaConfig(env)` (Instagram app) /
  `facebookAppConfig(env)` (Facebook Login, App 2: `META_FB_APP_*` only, both required, no `META_APP_*` fallback, R29) /
  `facebookConfigId(env)`; service functions with an optional env default to it. `metaSigningSecrets(env)`: webhook / deauthorize / data-deletion accept
  either app's HMAC. Facebook Page connect is ready only when `metaConfig` and `facebookAppConfig` both resolve (spa
  card, connect action, callback, health row `META_FB`). Redirect URIs: canonical domain only (R29; old platform
  domains redirect). Two Meta apps (R29): App 1 = Instagram API with Instagram Login (`META_APP_*` + verify token),
  App 2 = Facebook Login for Business (`META_FB_APP_*`, `META_FB_CONFIG_ID`): an app holds one Instagram setup; the
  console Meta card lists what goes where (`meta-app-1` / `meta-app-2`). Graph `GRAPH_VERSION = 'v25.0'` (R29).
- **OAuth state + cookies (R29):** nonce cookie per flow **and spa** — `nonceCookie('ig'|'fb', tenantId)` =
  `{ig|fb}_oauth_nonce_{tenantId}` (path `/api/integrations/meta`), Google `gbpCookie(tenantId)` = `gbp_oauth_{tenantId}`
  — read from the signed state's tenant, so two spas connecting in one browser don't collide. An expired but genuinely
  signed state (`signedState` / `signedGoogleState` = verify ignoring expiry) returns to that spa's integrations page
  with `?ig|fb|gbp=state`; only a bad signature goes to the dashboard root. e2e `oauth-state.spec.ts`.
- **One spa per Meta account (R29):** cross-tenant partial unique indexes `social_accounts_meta_connected`
  (platform, external_id) where connected + instagram/facebook, and `social_accounts_fb_ig_connected`
  ((meta->>'igUserId')) where facebook + connected (migration 0056). Saves go through `social.ts`
  `connectInstagramAccount` / `facebook.ts` `saveFacebookPage` (one tenant tx: `claimInstagramAccount` = advisory xact
  lock `meta-ig:{igUserId}` + re-check of other spas on a fresh snapshot, then save) → `'in_use'` on the re-check
  (`MetaAccountInUseError`) or a unique violation (`isMetaAccountInUse`). The callers' earlier check stays as a cheap
  pre-check (skips webhook subscription for an account in use). Tests: services `instagram.test.ts` ("one spa per
  Instagram account / Facebook Page", incl. a lock-held concurrent connect); test fixtures must give each spa its own
  IG id (e2e `instagram.spec.ts` `IG` / `IG_F19`).
- **HTTP clients** (no DB, fixtures in tests): `services/integrations/google.ts` (OAuth asks `GOOGLE_SCOPES` =
  business.manage + webmasters; `GoogleApiError.detail` = ErrorInfo / legacy reason; `googleErrorCode` →
  `api_disabled|scope|auth|client_config|permission|not_found|quota|network|other`, translated on the card via
  `settings.integrations.google.errors.*`; Place Actions `list|create|update|deleteBookLink`, `findOurBookLink`;
  Search Console `listScSites|addScSite|submitScSitemap|getScSitemap`, `scPropertyCandidates`/`pickScProperty`).
  `services/integrations/meta.ts`: `instagramClient(fetch, host)` (`'instagram'` = graph.instagram.com with the
  Instagram Login token, `'facebook'` = graph.facebook.com with a Page token — same paths), `createContainer`,
  `sendPrivateReply` (`/{ig}/messages` + `recipient.comment_id`); `facebookLoginClient` (code → long-lived user token,
  `pages()` with `instagram_business_account`, `debugToken`, `subscribePage` = install on the Page with
  `FB_PAGE_FIELDS` feed,messages, falling back to feed alone if Meta refuses — Instagram fields are subscribed in the
  app dashboard, never on the Page); `parseInstagramWebhook` takes `object: 'instagram'` (entry.id = IG account, both
  setups) and ignores `page` objects; `facebookAuthorizeUrl` (`config_id`
  when `META_FB_CONFIG_ID`, else `FACEBOOK_SCOPES`).
- **F17** `services/gbp-sync.ts` (state in the `gbp` row's meta, merged with jsonb `||`: `bookAction|bookUri|
  bookLinkName|bookError…`, `scState|scSiteUrl|scSubmittedAt|scDueAt…`): `setGbpBookAction` / `removeGbpBookAction`,
  `syncGbpBookActions` (worker), `submitGbpSitemap`, `markSitemapDue` (website publish actions call it),
  `submitDueSitemaps` (worker). Address outside a request: `services/site-url.ts` `publicSiteBase` (same rule as web
  `publicSiteUrl`), `googleBookingUrl` = `/book?src=google`. UI `components/integrations/gbp-site.tsx`; actions in
  `api/integrations/google/actions.ts` (`setBookButtonAction`, `removeBookButtonAction`, `submitSitemapAction`, all
  `guard(…, 'ai.manage', 'marketing')`; disconnect / change location remove the Book link first, best effort).
- **F18 formats**: `social_posts.type` ∈ feed|reel|story|carousel, `media[].type` image|video, `meta` = parked
  container ids. `instagramPublishPlan` (pure; `PublishProblem` codes → `marketing.problem.*`) feeds
  `publishInstagramPost` (claim → children → parent → poll → media_publish; `StillProcessing` parks the post as
  `scheduled` + `PROCESSING_NOTE`, the job resumes the same container, > 1 h fails). UI: `ai/content/post-format.tsx`
  + `setPostFormatAction` (drops parked containers).
- **F18 private replies**: `privateReplyState` (pure: available until comment + 7 days / sent / sending / expired),
  `sendPrivateReply` (claim row `kind = private_reply` + `SENDING_NOTE` under a thread lock → Graph → keep or delete;
  failures store nothing; never retried through `deliverReply`). AI: `@spa/ai` `draftPrivateReply` (`comment_agent`,
  1,000-byte clip) only fills `components/inbox/private-reply.tsx`; staff send (`sendPrivateReplyAction`, audit
  `inbox.private_reply` with `aiDrafted`).
- **F19** `services/facebook.ts`: pending row (`external_id 'pending'`, status `pending_page`, encrypted user token) →
  `chooseFacebookPage` (Page token encrypted, meta `igUserId|igUsername|fbUserId|dataAccessExpiresAt`, pending row
  deleted, other Pages disconnected) → `facebookView` (expiresSoon < 14 days). `social.ts` `getInstagramSender`:
  Instagram Login row first, else the Facebook row with `igUserId` (`via: 'facebook'`) — used by DMs/comment
  replies, publishing, private replies, profile lookups; `instagramOwners` (webhook → tenant) and the publish job
  also match Page-linked accounts; `forgetInstagramUser` also clears Page rows by `fbUserId`. Web:
  `api/integrations/meta/facebook-actions.ts` + `facebook/callback/route.ts` (state + `fb_oauth_nonce_{tenantId}`, ai.manage +
  marketing), `components/integrations/facebook-card.tsx`. Tests: services `gbp-sync.test.ts`,
  `instagram-formats.test.ts`; ai `instagram.test.ts`; e2e `instagram.spec.ts` (F18/F19 test).

## Site builder

- **Puck config** (`components/site/config.tsx`), 25 blocks:
  - layout: Section, Columns, Stack, Spacer;
  - content: Hero, Heading, RichText, ButtonGroup, Image, Gallery, Video;
  - smart: ServicesMenu, Team, OpeningHours, Map, BookingCTA, WhatsAppButton, Reviews, InstagramFeed, BlogList;
  - more: Testimonials, FAQ, EnquiryForm, Footer;
  - hidden: GlobalSection, HtmlDesign, BlogPost (post page article).
- **F15 blocks** (`blocks/extras.tsx`; data loaded per request in `data.ts` `loadLive` → `SiteData.posts/reviews/
  instagram`; data blocks with nothing to show render nothing live and a dashed `[data-editor-note]` in the editor):
  - Map: card (address via `addressLinkProps`, "Open in Google Maps" = `mapHref`, WhatsApp) + optional embed
    `@spa/core` `mapEmbedSrc` (pin coordinates from the Maps link, else the address; `google.com/maps?…&output=embed`,
    no API key) in a lazy sandboxed iframe; editor shows a placeholder (no Google iframe in the canvas). Layouts
    split / embed / map / card.
  - Video: `url` = `videoField` (`video-field.tsx`: link or upload, AI kind `text`) parsed by core `parseVideoUrl`
    (YouTube watch/share/shorts/embed/nocookie, Vimeo + private hash, or a same-origin `/files/{id}`). YouTube/Vimeo =
    `VideoPlayer` (client): poster button (custom poster, else YouTube's still), iframe only after the click
    (`videoEmbedSrc`: youtube-nocookie autoplay rel=0, Vimeo dnt=1). Uploads: `POST /files/upload?kind=video`
    (`site.design`, MP4/WebM by magic bytes `sniffVideoType`, ≤ 8 MB = stored-file cap, `media_assets.kind = 'video'`,
    kept out of the photo library/pickers via `listAssets` kind filter); `/files` serves videos with single byte
    ranges (206/416, Safari needs them); `<video preload="none">`. Preflight warns "Video has no video yet".
  - Reviews / InstagramFeed: Premium `marketing` (`hasFeature` in `loadSite`; null = not on plan). Services
    `site-feeds.ts`: `siteReviews` (Google rows, avg + count over all, newest with text ≥ min rating, name shown as
    "Layla M." `reviewerName`), `siteInstagram` (connected account + `social_posts` published on Instagram, first
    picture, `/files/…` or https only; links to the profile — no Graph API call, no permalinks).
  - Blog: `site_posts` (tenant, RLS; slug unique per spa; EN/AR title/excerpt/body/SEO; plain-text body →
    `site-kit` `postBlocks`: blank line = paragraph, `## ` = h2, `- ` = bullets). Studio card "Blog" on
    the console spa page → `websites/[slug]/blog/[postId]` (`new` = create; `post-form.tsx`, cover via `ImageInput`) →
    `blog-actions.ts` (studioGuard: save `site.content`, publish/unpublish/delete `site.publish`; audit
    `site.post.*`). BlogList links `{base}/blog/{slug}`; `public.tsx` `postSlugOf` + `PostPage` renders hidden
    `BlogPost` + the home page's last Footer/WhatsAppButton through the same config (published theme); metadata
    `postMetadata` (canonical/hreflang only when the title has Arabic, og:type article, cover → og:image), JSON-LD
    core `blogPostJsonLd` (DaySpa graph + BlogPosting), sitemap `blog/{slug}` entries (`siteSeo.posts`).
  - EnquiryForm: client `blocks/enquiry-form.tsx` (honeypot `company`, Turnstile action `enquiry`, action imported on
    submit so the block config stays importable outside Next) → `components/site/enquiry-actions.ts`
    (`sendSiteEnquiryAction`: honeypot → services `siteEnquirySchema` (error codes → EN/AR site strings) →
    `withinIpLimit('site-enquiry', 5/h, 20/day)` → `passesBotCheck` → `resolveSiteTenant` + `acceptsBookings` →
    `site_enquiries` (keyed `ip_hash`) → audit `site.enquiry.received` (ip null) → bell/push `enquiry.site`).
    `SiteMeta.form` (site key + Turnstile key) is set only by `PublicSite`; editor/previews show the form disabled.
    Dashboard `enquiries/` (EN+TH `enquiries` namespace; filter new/replied/closed/all + search; phone only with
    `clients.phone`; "Reply on WhatsApp" = wa.me with `siteEnquiryReplyText` in the visitor's language, marks
    replied; status moves `clients.manage`, audit `site.enquiry.status`). Nothing is emailed to the visitor.
    R26: an HTML design's booking form → `POST {site}/crm-enquiry` (`server/crm-feed-routes.ts`: 404 unless the
    live site has a contract design (`crm-feed.ts` `siteUsesCrmContract`, cached by the live version ids from services
    `liveHtmlDesignVersionIds`), ≤ 8 KB, JSON only, Origin null/same (none → 403), honeypot, services `designEnquirySchema`, per-IP `SITE_ENQUIRY_LIMITS` + per-spa
    `DESIGN_ENQUIRY_TENANT_LIMITS` 30/h + 150/day always on, service/staff resolved server-side) → shared
    `server/site-enquiry.ts` `recordSiteEnquiry` (also the EnquiryForm action) with `site_enquiries.booking`
    (`SiteEnquiryBooking`); inbox shows "Booking request · service · n min · guests · date at time · with staff",
    search matches the service, `siteEnquiryReplyText` names date/time and the service only when the CRM resolved
    it (the visitor's typed text never goes into the spa's WhatsApp message; first name only when it reads as a name).
    **Make booking (2026-10-13):** a Booking-request row (`calendar.manage`) links `/calendar?enquiry={id}`; `loadCalendar`
    builds the `EnquiryPrefill` (client by phone E.164 or new, active service + offered length, therapist only if in
    `day.staff` with a column and not on leave, date = business date of `calendarDate` + time under the branch cutoff,
    source Website = `online`, notes; 2026-10-13: was whatsapp) and CalendarView opens New booking once (param dropped). `createBookingAction` takes
    optional `enquiryId`: re-checks `clients.view`, `lockSiteEnquiryForBooking` (FOR UPDATE; refuses plain messages,
    other spas, a live booking), booking + `linkSiteEnquiryBooking` (`booking.bookingId/bookedAt/bookedBy`) in one tx,
    audit `site.enquiry.booked`; a cancelled booking reopens it (`siteEnquiryBookings`). Row → "Booked" link;
    `siteEnquiryReplyText(e, spa, { hours, booked })` = confirmation text. After midnight: core
    `afterMidnight(date, time, hours, cutoff?)` (hours past midnight and time before close → next day; no hours →
    before the cutoff), services `websiteHours(tx)` → `{ openingHours, cutoff }` (main branch), `enquiryNight`;
    crm-enquiry stores `afterMidnight` + `calendarDate` (`date` = the night chosen). e2e `enquiry-booking.spec.ts`.
  - Presets (Library): google-reviews, instagram-feed, contact-map, contact-enquiry, video-feature, blog-latest
    (category `media` = "Video & blog"). Template defaults via `templates.ts` `extraBlocks(key)` (own id prefix
    `{key}-x-…`, so existing node ids don't shift). E2E `site-blocks.spec.ts`.
- **Props**:
  - Content is `{en, ar?}`; AR falls back to EN, and `{name}` becomes the spa name.
  - Style is `{base, md?, lg?}`, compiled to CSS variables (`style.ts`).
  - `advanced` holds the schedule and scoped custom CSS.
- **Photo framing**: every image prop (`imageField`) holds a URL (all older pages) or `{ src, frame: {base, md?, lg?} }`
  with focal point x/y 0–100 %, fit `cover|contain`, zoom 1–2× (`@spa/services/site-kit/image.ts`: `imageSrc`,
  `normalizeImage`, `toImageProp` — stores a plain URL again when unframed — `imageFrameVars`). Render =
  `FramedImage` (`blocks/shared.tsx`: clipped `.sb-frame` wrapper + `.sb-img`, site.css vars → object-fit /
  object-position / `transform: scale` with the focal point as origin; physical %, never mirrored in RTL); used by
  Image, Gallery, Hero split, Section/Hero-banner backgrounds (Team photos are staff records, not framed). Editor:
  `media/image-frame.tsx` under the image field (drag/click/arrow-key focal dot, Fill/Fit, zoom, Reset; base frame
  by default, tablet/desktop tabs add overrides); picking a new photo resets framing. Preflight, template scrub and AI
  ops (`{src?, frame}`, src omitted = reframe) accept both shapes. E2E: `image-frame.spec.ts`.
- **Themes and templates**: theme tokens in `sites.theme`; 23 built-in templates — 8 classic (`templates.ts`) + 15
  design templates (R5, `templates-designs.ts`); 24 section presets + one "3D motion" preset per design scene, and 7
  page templates (`presets.ts`). Studio rows in `site_templates` override built-ins by key.
- **Design templates (R5)**: look = theme tokens `headingFace` (self-hosted @fontsource faces, `site-designs.css`),
  `backdrop` (CSS-drawn hero art), `emblem` (hero art built from the spa name + live hours/prices, shown when the
  hero has no photo; `blocks/hero-art.tsx`), `emphasis` (`*word*` in headings). Motion = per-band `scene` props set by
  `applyMotion` (fan, cube, doors, coverflow, road, pages, prism, slabs, layers, blocks, brochure, turn — pose scenes
  in `lib/scenes.ts`, all ending at rest). Scroll scenes are off in the editor; ambient hero loops stop in the editor
  and under OS reduced motion. Gallery thumbnails: `public/site-templates/{key}.webp`, regenerated with
  `THUMBS=1 pnpm --filter @spa/web e2e template-thumbs` (studio rows keep the live iframe preview).
- **HTML designs (R17, R24)**: `/platform/templates` "Upload HTML" (client `TemplateUploadSheet` → `POST
  /files/templates?kind=html`, route handler: server actions cap bodies at 1 MB; ≤ 5 MB `MAX_HTML_UPLOAD_BYTES`, client
  check first + streamed byte counter, super-admin + 2FA; "Import JSON" = `kind=json`, ≤ 11 MB `MAX_TEMPLATE_FILE_BYTES`:
  an export inlines its designs; pages ≤ 2 MB once designs are files) saves a studio template
  whose home page is one hidden `HtmlDesign` block (`components/site/blocks/html-design.tsx`, category `design`,
  `visible: false` ⇒ out of the AI schema; values/pages helpers in `html-design-values.ts`); root prop
  `htmlDesign: true` makes the root render skip `SiteFrame`.
  - **Stored byte for byte as a file (R24 review, owner rule):** the uploaded file is decoded like a browser opening it
    (`@spa/core decodeHtmlBytes`: BOM → `<meta charset>`/http-equiv in the first 1 KB → valid UTF-8 → windows-1252;
    Node 22 decodes windows-1252 as Latin-1, so 0x80–0x9F are mapped by hand; the upload message says "read as …" when
    not UTF-8; the console preview decodes the same way) and stored as ONE file, nothing rewritten or moved out:
    template → `site_template_files` (content-addressed, `text/html; charset=utf-8`; `/files` never serves these),
    spa → its own PRIVATE `stored_files` row (purpose `html_design_doc`, filename `{sha256}.html`, deduplicated). The
    block holds `props.doc` (`HtmlDesignDoc` {file, sha256, bytes, chars}) and `props.html = ''`; designs stored before
    keep `html` inline (read as is). Readers (services `site-html-assets.ts`): `spaHtmlDocReader` (tenant + purpose
    checked) / `templateHtmlDocReader`; `resolveHtmlDesignDocs` fills `html` right before rendering (web
    `server/html-design-files.ts` `spaDesignData` / `templateDesignData`, LRU ≤ 64 MB of UTF-8 bytes by file id + sha): published.ts
    (live page + site-html), draft-preview (draft / starter / live), template preview, shared preview link. The Studio
    editor keeps the references in its data (it saves it back; a design wouldn't fit a 1 MB action body) and gets
    the designs in `meta.htmlDocs` (`editorHtmlDocs`); the block renders `html || meta.htmlDocs[doc.file]`. Console
    Images sheet loads the design on open (`loadHtmlDesignAction`). Template apply (`materializeTemplatePageData`,
    console + connector, always) copies the document into the spa (+ localises /files URLs of templates / other spas,
    incl. image replacements → `html_design` public copies); "Save site as template" copies spa documents into
    template files (`spaDesignsIntoTemplate`); JSON export inlines them (`inlineHtmlDesignDocs`; a missing file → 409
    text, not a 500); import stores them as template files again (`templateDesignsIntoFiles`, ≤ 5 MB each like an
    upload; a pre-R24 design keeps `bakedFixes`). Only limit: 5 MB upload / 5 MB UTF-8 connector (8 MB stored-file cap).
    - **Budget + clean-up (R24 review):** new `html_design_doc` files ≤ `HTML_DESIGN_DOC_BYTES_PER_DAY` (200 MB) per
      spa and Dubai business day (05:00 cutoff; dedup hits free; `htmlDesignDailyLimit`, TH flagged for review).
      Worker `html-design-docs-prune` (daily 04:45) → `pruneUnusedHtmlDesignDocs`: deletes docs older than 7 days
      (`HTML_DESIGN_DOC_KEEP_MS`: editor local copies / Ask AI undo live in the browser) that no page version,
      `sites.template_undo` or saved section mentions (text match on the id, site lock held). References must be
      UUIDs (`isHtmlDesignDocFile`; a bad one renders as an empty design); `/files` never serves `html_design_doc`
      (nothing fetches it; drafts stay private). The Studio editor fetches designs a restored version / local copy
      references but it didn't load (`editorHtmlDocsAction`, `site.content` studio guard). Embedded `data:` images, fonts,
    scripts and styles stay exactly where they are (no script-visible change: an image read while parsing is loaded).
    Upload / connector results list embedded third-party frames / players (`htmlDesignEmbedHosts`, warning
    `htmlDesignEmbedWarning`; see Residual).
  - **Hosted design files (2026-10-13, BE RELAX v2.2):** our own designs keep built-in pictures + fonts as static files
    `apps/web/public/designs/{design}/{sha256-16}.{ext}` linked by absolute `https://spamanagement.co/designs/…` URLs
    (next.config headers for `/designs/:design/:file(ext)`: immutable, CORS `*`, CORP cross-origin; 404 uncached).
    **Never rename or delete one** (published designs link them). The platform still never moves a design's data: URIs
    (R24); template roll-out skips an own-look pin when the new version hosts the same bytes (`hostsSamePicture`).
    Measured gap: a CSP-sandboxed design page (opaque origin) gets no browser-cache reuse in Chromium.
    v2.3 adds smaller copies of the 5 journey stills (`be-relax/4d56333a0e00bb38.webp` 1600w of the 2400w welcome;
    `d832cd6835a80aac`, `c4e79f1703476507`, `c459a030bf14c7a8`, `75185604fe28f660` 800w of the 1200w portraits; WebP
    q78): the design's literal keeps the originals' absolute URLs (same data, rollout unchanged) and its head script
    maps them to srcset at runtime, rewriting `https://spamanagement.co/designs/` → `/designs/` when served over http(s)
    (every host serves `/designs/*`: the proxy matcher skips the extensions; frames resolve it through their `<base>`).
    A sandboxed page's preconnects are never used (its requests open their own connections), so v2.3 has none.
    v2.5 (file only; contract doc §8 "No delay on a reload"): `contract.inline` = `spa.logo_on_dark` +
    `journey[welcome].image` (default → the 1600w copy), Latin fonts inline, `rel=expect` render-block marker after the
    page script, the 2400w original after load only where srcset would pick it (Chromium 141: sizes × DPR > 1600),
    Arabic faces `url(/designs/…)` first (apex fallback) on the page's one connection.
  - **Exact by default (R24 owner rule):** `props.phoneFixes` (NO default in Puck props: absent = stored before R24 = on,
    `@spa/core htmlDesignPhoneFixes`; every writer stores a boolean). Off = only invisible additions: compat shim first in
    <head> (`HTML_DESIGN_COMPAT_SHIM`: in-memory localStorage/sessionStorage + cookie jar, only where access throws),
    `{{placeholders}}` where written, `<style data-spa-map-style>` only when an `{{address}}` link was spliced, `<base>`
    + link script in frames. On = `fluidImages` + viewport + `HTML_DESIGN_BASE_CSS` at render (stored HTML never fixed).
    Console: "Phone fixes" checkbox in the upload sheet (drives the adjuster preview) + per-row switch
    (`setHtmlPhoneFixesAction`, audit `platform.site_template.html_phone_fixes`; spas keep their copy until re-applied).
  - **Live page of an exact design = the design document** (`server/html-design-route.ts` `exactHtmlDesignAt`: one
    platformDb query, published visible page with an HtmlDesign `phoneFixes:false`, LRU 30 s, cleared by
    `revalidateStudio` / host + slug invalidation): proxy rewrites GET/HEAD to `app/site-html/route.ts` (per-process key
    header; unreachable from outside), headers `htmlDesignPageHeaders` (CSP = frame policy incl. `sandbox`, never
    allow-same-origin; no COOP; Permissions-Policy without the motion sensors). Body = `htmlDesignDocument(…, { top:
    true })` + JSON-LD, canonical / `<title>` only if the design has none, `t.js` (`text/plain` beacons from the opaque
    origin); `x-robots-tag` when not indexable. Not an exact design any more → 307 to `?__page=1` (normal page, no lookup).
  - **Frames** (editor, Studio/CRM/template previews, legacy designs, fallback): `HtmlDesignFrame` (`<iframe
    src=/api/html-design/frame sandbox=HTML_DESIGN_SANDBOX allow="autoplay; fullscreen; clipboard-write; web-share;
    picture-in-picture; encrypted-media; screen-wake-lock; xr-spatial-tracking; accelerometer; gyroscope; magnetometer
    (all *)" allowFullScreen>`; the hosting page's Permissions-Policy still decides). F10: not `srcdoc` (it would inherit
    the page's strict CSP): the shell answers with the design's own CSP (+ design Permissions-Policy), asks the hosting
    page for the design by postMessage, decodes its data: images (`<img>`/`<source>` src + srcset, found by an inert
    DOMParser parse) into the document's list of available images — R24 review: under `document.write` a data: image
    is not yet loaded when the next script reads it, as it is in a parsed page; a `blob:` document instead would break
    every #fragment navigation (Chromium: "Not allowed to load local resource") — then `document.write`s the design
    once (with `<base>` = hosting page URL) and posts `spa:html-design-shown` (the host focuses the frame only on a
    full-page, non-editor view). A changed design → a new `<iframe>` element (React key), never a reload of this
    one: the shell's `document.open` cancels a pending navigation, so a shell still writing the previous design kept
    it (Chrome 153; CI failure of html-upload "local copy … once restored"). Link script (window,
    bubble phase, skipped when the design prevented the default): `#x` → fragment navigation of the frame itself (the
    `<base>` would load the hosting page into the frame); exact designs: links/forms without target → `_top`; legacy:
    http(s) → new tab; inert when `meta.editing`. site.css: `html:has(.site-html-root)` overflow hidden (one scroller).
  - **Files a design uses (R24):** core `html-design-assets.ts` (`htmlDesignAssetRefs`: img/source src+srcset, video
    src+poster, input[type=image], link icon/apple-touch-icon/preload, SVG image/feImage href, style attrs, `<style>`
    url() + image-set() strings; scripts/comments/raw text skipped; unclear CSS left alone; `rewriteHtmlDesignAssets`
    only swaps URL ranges, adds nothing), `patchHtml`. Used only when a template is applied (localise above). `/files`
    serves template files when no stored file matches (videos with byte ranges, like stored files — shared
    `bodyResponse`) and sends `Access-Control-Allow-Origin: *` on public responses (fonts from the opaque origin are
    CORS requests).
  - Ops layer (`site-edit.ts`): `html_design` (≤ 5 MB UTF-8 bytes — Arabic is 2 bytes a letter, `phone_fixes` default
    false, `convert` turns a block page into a design page and labels the old draft "Before AI assistant HTML design
    …"), `html_patch` (exact find/replace on the stored document, each find exactly once, all-or-nothing),
    `getHtmlDesign`; the document file is written only when the batch is (dry runs store nothing, `doc.file` = '').
    Result `html: [{ page, chars, bytes, phoneFixes, embeds, at }]`.
  - **Placeholders by context** (`fillSpans`, quote-aware tokenizer): page text = HTML-escaped (`{{address}}` may
    become the maps link), attribute values / title / textarea = HTML-escaped, JS + JSON script bodies (no type,
    module, JS / JSON / +json / importmap / babel / jsx types) = JS-string text (`\uXXXX` for quotes, `<`, `&`, `$`,
    controls — valid in JSON and every JS quote style), `on…` handlers = JS-string text then HTML-escaped, `<style>` =
    CSS hex escapes; never filled in comments, doctypes or other script types (`text/x-template`, Handlebars …).
  - **CSP of the design** (`htmlDesignFrameCsp`, also the live page): only `default-src` / `script-src` / `style-src`
    (`* data: blob: 'unsafe-inline' 'unsafe-eval'`), `frame-ancestors 'self'`, `sandbox` — every fetch directive falls
    back to default-src (data:/blob: fetch + XHR, `<object>`/`<embed>`, data:/blob: frames, blob: fonts work), no
    form-action (mailto: forms work). Narrower directives added no safety to a sandboxed document running any script.
  - **Tracker on the design page** (`public/t.js`, `self.origin === 'null'`): no sessionStorage, no `window.spaTrack`,
    no patched history (Navigation API `currententrychange`, else a 1 s path check); the entry's utm_*/src/partner go
    onto same-site links at click time (window bubble listener, skipped when the design handled the click, href put
    back right after), so `/book` credits F13 sources and F16 partners (e2e `growth.spec` "R24 + F16"). An
    external referrer alone is not carried across a design page.
  - **CRM data feed (R26, `docs/design/html-crm-contract.md`):** a design with a `window.CRM_DATA = {json}` literal
    and/or `<meta name="crm-endpoint">` (core `htmlCrmContractOf`) gets the spa's live CRM data: core
    `buildCrmContract` (pure: branches default first, website services = services `websiteServices` = the CRM Website
    "On the website" rule + `image_url`, staff = services `websiteStaff` (active + `staff.show_on_site`; also the
    block sites' Team data, `components/site/data.ts` loadLive), logo; no booking url) → `mergeCrmContract` (CRM wins
    for operational keys; an empty CRM value / list keeps the design's only on the spa's own design (R28 D1: another
    spa's design shows nothing there); staff: none opted in → [], no photo after the merge → left out (R28 D2); area
    label = CRM city (own design: its own first); same-name services collapse to one (`collapseSameName`); booking url
    stays the design's; logo on dark stays the design's when the design names this spa; per-item
    image/note/description/specialty only from the same-name item; prices never inherited) → `crmScriptJson`
    (script-safe, memoised for the design's objects) → `spliceCrmData` (only the literal's JSON range). Web
    `components/site/html-crm.ts` `designWithCrm` (isomorphic; parsed design by `file:sha256`, output by + CRM hash)
    runs before `htmlDesignDocument` in the HtmlDesign block (frames: endpoint-only designs get the JSON injected) and
    `app/site-html`. `SiteMeta.crm` from `components/site/crm-feed.ts` `crmFeedMeta` (`{}` unless the page has a
    contract design; one withTenant `crmFeedFacts`): PublicSite + site-html (`live`: form endpoint on the request
    host, `server/origin.ts` `siteOriginFrom`), draft-preview, share link, Studio editor (no endpoint). Endpoints
    `{site}/crm-data.json` + `{site}/crm-enquiry` (`server/crm-feed-routes.ts`, route files under `app/site/[slug]` and
    `app/domain/[hostname]`): see Website enquiries. Upload message + connector `get_html_design.crm_contract`.
    **P5:** `crm-data.json` adds `locale` (`mergeCrmContract(null, crm, {locale})`); `?page={slug}` (an endpoint
    design's `{{crm_data_url}}` placeholder = `{base}/crm-data.json?page={slug}[&lang=ar]`, html-design-values.ts):
    that visible page's newest published HtmlDesign (one withTenant SQL; LRU 1000 by tenant + version id) → its
    `crm-defaults` (literal designs: none, they never fetch) with its `content` overlaid (v2 + `ar`: `l10n.ar` first,
    `/files` absolute), then the CRM, `form_endpoint` for that page; unknown / hidden / invalid pages → the CRM alone
    (200). `designWithCrm` (P5): v2 designs get `locale` in the data (and `l10n.ar` on `ar`, memoised per parsed
    design), endpoint designs in frames inject `crm-defaults` + content; output key `…|{locale}` on v2 or with
    content values (v1 keys / output as in P4).
  - **`contract.inline` (owner 2026-10-13 "no delay when I reload"; contract doc §10):** the sandboxed live page
    reuses nothing from the browser cache, so a design's declared first-screen pictures (`contract.inline` paths) go
    into CRM_DATA as `data:` URIs (+ `inline_originals`). Core `html-crm-inline.ts` (`crmInlinePaths`,
    `crmInlineSource` — `/files/{uuid}` / `/designs/{d}/{name}.{webp|png|jpe?g|avif}`, relative or on `ourHost` only,
    no query —, `sniffRasterType` (never SVG), `planCrmInline` (≤ 80 KB each, ≤ 240 KB a page, waits ≤ 300 ms:
    a late read stays a link that render and fills the cache), `applyCrmInline`
    (copy-on-write, only where the value is still the planned url), `createCrmInlineLoader` (LRU by size, file keys per
    spa, misses 60 s, read errors 30 s, shared in-flight reads, one spa's file loads of a tick → one `readFiles`));
    services `crmInlineFiles(tx, tenantId, ids, max)` (one query: own + public + image + not a design doc, size
    checked before any byte; db bytes in the tx) + `crmInlineFileBytes` (bucket GET after the tx, 5 s
    `getObjectBytes` timeout); web `server/crm-inline.ts` (`crmInlinePlan` for `app/site-html`,
    `pageCrmInline` → `SiteMeta.crmInline` by designKey for `public.tsx` frames + the share link; global loader
    ≤ 32 MB; hosts: `platformRoots()` + the spa's own via `resolveSiteTenant`; `public/designs` read from disk, never
    fetched). `designWithCrm(…, {inline})` applies it last, output key `…|in:{hash(plan)}`; `crmScriptJson(…,
    {transient})` keeps those strings out of the design's memo. Studio editor + console previews: never.
  - **Website content (R28, `docs/design/r28-dynamic-html-designs.md`):** per-spa values over a contract design's own
    `window.CRM_DATA` (story scenes, experience, booking label / picture, message templates; never operational keys).
    Core `html-content.ts`: `htmlContentSlots(data)` (every editable leaf: path `journey[welcome].title` — items by
    unique `id`, else index —, kind from key + value), `overlayHtmlContent` (copy-on-write, locale pick AR → EN, stale
    paths / wrong kinds / operational keys skipped; no content → same object), `htmlContentErrors(content, slots)`
    (save time: slots — `null` = shape only —, kinds, ≤ 2000 chars, ≤ 192 KB, page texts / pictures by id + src guard,
    pictures `/files/{uuid}` or https without parentheses or character references — a pasted `&amp;` reads as `&`,
    `$` allowed; core `htmlImageUrl` gives the URL the render uses), `htmlContentFileIds` (values + pictures). Stored as the
    HtmlDesign block prop `content` = `{v: 1, values: [{path, value}], texts: [{id, src, t: {en, ar?}}], pictures:
    [{id, src, img}]}` (`htmlContentParts` / `htmlContentFrom` / `htmlContentOf(map, keep)` / `htmlContentMap`; lists,
    never objects keyed by path or id — Puck flattens block props on "." with the `flat` package and would split such
    keys; no Puck default; draft → publish with the page).
    **Page texts + pictures (P4):** core html-design.ts `listHtmlDesignTexts` (one walker `textSites`, tokenized like
    `fillSpans`; ids positional on the raw file: `txt-n` text runs, `attr-n` alt / placeholder / aria-label / title,
    `title` (first outside svg), `meta-description`; only runs / values without `<` or `>`; script and raw-text bodies
    skipped, so ids survive the CRM splice; text = references decoded (numeric + the common named set, exact case;
    a run / value holding an unknown or ambiguous one is not listed and takes no id), HTML whitespace collapsed
    (U+00A0 kept); `src` = first 300 chars of it; `group` = nearest
    section/header/nav/footer/main/aside/article/form/dialog by aria-label > first heading > id > "Section n"; `bound`
    (listing only) + `boundBy`: 'crm' = `data-crm*` / `data-item*` / `data-book-service` on the element or an ancestor
    (attributes too); script-written = text runs inside an element whose text the design's JS writes (`scriptTextIds`,
    one pass per script: `getElementById('x')` / `querySelector('#x')` (one compound: `#x.on`; never `#x span`) /
    `$('#x')` (jQuery `.first()` / `.eq(n)` allowed) + `.textContent` / `.innerText` / `.innerHTML` / `.outerHTML` `=`
    / `replaceChildren` / jQuery `.text(v)` / `.html(v)` / `.empty()` (text replaced; `+=`, appending nodes or writing
    through child access never binds the element's own texts; `#x tag` / `#x > tag` binds only that tag's texts inside
    `#x`), directly, via a variable, a helper, an id array looped with `.forEach` /
    `.map` / `for…of`, or a holder object (`els.x.textContent`); never attributes; listener / read-only ids stay
    editable; the CRM_DATA literal not read) and `document.title =` for the title: `boundBy` 'crm' on a contract design
    (`CRM_DATA` literal or crm-endpoint meta), 'script' only without one; op errors "filled from the CRM — change it in
    the CRM" / "filled by the design's script — change it in the design file (patch_html_design)") and
    `applyHtmlTextOverrides` (first step
    of `htmlDesignDocument`, on the html after `designWithCrm`; same id + src only, escaped (`<` `>` quotes `=`); EN
    page `t.en`, AR page `t.ar` → `t.en`; either may be missing (Arabic-only keeps the design's English); a blank
    value or one equal to the listed design text keeps the original bytes; `{{placeholders}}` in a value filled there
    as plain escaped text and `{` written as `&#123;`, so no later pass links them; nothing applied → the same
    string). The `html_content` op: page texts' `t.en` optional (null / left out keeps the stored English, '' drops
    it), one of en / ar not blank; data values `{t}` too (no en: the stored English, else the design's, is stored with
    the Arabic; '' = the design's English, and without Arabic the value is reset); an English text that is the design
    text cut short ("…", ≥ 100 chars before it) is refused, the whole design text echoed (one ending with "…" itself,
    compared whitespace-collapsed) is not. `runSiteEdit({htmlContent: {clip}})` (Ask AI only): entries whose design
    text is longer than `clip` (the AI saw it cut) and entries that don't fit (unknown / bound ids, a cut-short copy, a
    bad value, a foreign file) are dropped with summary notes ("<page>: not changed — …", first 5) instead of failing
    the op; all dropped → nothing written. `htmlPictureAdjustments(images, content)`: pictures over the block's
    `images` by id (same src → framing kept + `replace`; else a replace-only entry; none → the same array).
    `htmlContentView(html, content, opts)`: slots + page texts (search, `start`/`limit` paging, `bound: false` filter)
    + pictures + stale (connector, Ask AI); `clip` (default 400) cuts long design strings with "…" and marks them
    `cut: true` + their full `length` (AI callers never translate or rewrite a cut entry).
    `htmlContentLeftovers(…, {page})` adds unbound page texts and stale `text:` / `picture:` entries (a text counts as
    set only with non-blank English; Arabic-only entries keep the design text checked).
    Render: `designWithCrm(…, {content, locale})` overlays `content.values` before `mergeCrmContract` (output cache key
    + locale + hash of `content.values` only; `hasHtmlContent` = values only, so texts / pictures-only content keeps
    R26's no-content path and key); the HtmlDesign block and `app/site-html` pass `texts` + `locale` and
    `htmlPictureAdjustments(images, content)` to `htmlDesignDocument` (the title override reaches the tab on exact
    pages; framed pages: `generateMetadata` uses the title / meta-description overrides — id + src guard, locale,
    placeholders). Cost: with page texts set, every render walks the file once more
    (≤ 5 MB, ~0.2 s worst case; early return without texts). Writes: site-edit op `html_content` (`set` / `texts:
    [{id, t}]` / `pictures: [{id, img}]` / `reset` (paths, `text:<id>`, `picture:<id>`) / `'all'`; checks slots and
    ids against the stored design, refuses bound texts, the server fills every `src`; a design without CRM_DATA takes
    texts / pictures / reset but never `set`; pictures must be this spa's public `stored_files`) — connector
    `get_html_content` / `set_html_content` (drafts only; `patch_html_design` = structure). Draft saves: console
    `storeDraft` runs services `htmlDesignContentErrors(tx, tenant, data)` (shape only; malformed file ids, the spa's
    private files and other spas' files refused — platform-role read —; the spa's own files deleted since and stale
    entries allowed; the op stays strict: only this spa's public files). Templates: apply
    (`materializeTemplatePageData` / `localiseHtmlDesignAssets`) copies content `/files` (values img / video,
    pictures) into the spa (uncopyable foreign ones dropped); "Save site as template" (`sanitizeTemplatePages`) keeps
    an HtmlDesign's file, `images` and src guards and scrubs its content (`scrubHtmlContent`: emails, links, 9+ digit
    phones out of texts / tags in EN + AR, the spa's name → `{{spa_name}}`, `/files` pictures / videos dropped, blank
    texts dropped).
    **Connector, Ask AI and Write texts (P4):** `get_html_content` works on every design (`htmlContentView` slots /
    page texts / pictures, `part` / `search` / `start` / `limit`, `set_count` over all parts, the first 30 leftovers
    with the spa's CRM city; a note instead of the old early return without CRM_DATA; `ids` (≤ 50 text ids / slot
    paths / picture ids) returns just those with their whole design text, never cut, so a connector AI reads a `cut`
    entry whole before translating it); `set_html_content` takes
    `texts: [{id, t}]` / `pictures: [{id, img}]` / `reset` `text:<id>` / `picture:<id>` (drafts only; audit counts).
    Studio Ask AI (`editor/ai-edit-actions.ts`): an HTML-design canvas → `htmlContentView(its source, its content,
    {clip: 160, limit: 300, bound: false})` → `planSiteEdit({html})` (extra `html_content` op line + rules + a
    `<content>` block, the block's content left out of `<page>`, 12 000 tokens; block pages: prompt unchanged); the
    agent's `html_content` texts `{id, en, ar}` → `{id, t}`; the dry run and Apply pass `htmlContent: {clip: 160}`
    (cut entries dropped with a note); Apply allows `html_content`. Write texts
    (`write-texts-actions.ts`): `textSlots(data, schema, {html})` → site-kit `htmlTextSlots` (data text / longtext
    values `{block}/content:{path}` + unbound page texts `{block}/text:{id}` with their src; ≤ 400 a page);
    leftover keys (`htmlContentLeftovers` with `page`) first and named in the prompt (`planSiteTexts({htmlDesign,
    leftovers})`: keep `{{…}}`, keep lengths); the save re-reads the design (other doc key → nothing written),
    `fillTextSlots(…, {html})` writes `content` only where the slot and the design text are unchanged, compares the
    design signature without HtmlDesign `content` and runs `htmlDesignContentErrors` before `saveDraft`.
    Editor (P2): HtmlDesign `content` field = `components/site/editor/html-content-field.tsx` (lazy, Suspense; reads
    the design via `useGetPuck().selectedItem` + `EditorContext.html.docs`, local state → `onChange` debounced 700 ms,
    flushed on unmount); `EditorContext.html` = `{docs, spaName, city}` from the Studio editor; HTML-design pages open
    with the block selected + `rightSideBarWidth: 400`. P4: local state = `htmlContentParts`, emitted with
    `htmlContentFrom` (all three parts kept); **Page texts** on every design (no CRM_DATA → CRM groups hidden + a note;
    searchable, grouped, title + meta first, ≤ 200 rows rendered only while open; bound texts read-only, worded by
    `boundBy` ("from the CRM" + "Go to field" for a `data-crm` slot / "the design's script"); the guard `src` = the
    listed text's; an Arabic-only edit stores `t: {ar}` only (English page = the design's bytes); outdated entries →
    Remove) and **Pictures** (`ImageFieldControl` per listed image, frame dropped, `/files` or https without
    parentheses); data-slot pictures / videos (`SlotImage` / `SlotVideo`) reach `onSet` only when `contentUrlOk`
    (partial / invalid links stay local with a hint, so draft saves never meet them); `editor/html-content-labels.ts` = slot / page-text / leftover
    labels (`kindLabel`, `textLabel`, `leftoverLabel`) + `designListing` (texts + images per `designKey`, last 4);
    the editor `PublishSheet` adds a non-blocking "Website content checks" section (same leftovers with `page`, first
    5, "Open Website content" selects the block; never sent to `publishCheckedAction`). Readiness: core `htmlContentLeftovers(data, content, {spaName,
    city, arabic})` + `isOwnDesign` / `UAE_CITIES` (html-crm.ts). Not a CONTENT_KEYS prop (Section's `content` slot
    shares the name): editing it needs `site.design` (super-admins).
    **Contract v2 (P5, core; authoring rules: `docs/design/html-crm-contract.md` §9):** html-crm.ts
    `crmContractManifest(data)` (the data's `contract{version ≥ 2, locales, fields, l10n.ar}`, invalid parts dropped,
    memoised per contract object; null = v1), `crmContractVersion`, `contractField(m, path)` (exact pattern
    `journey[].clip` first, then the longest `.*` prefix), `englishOnly`, `systemCopy` (`ui.*` English-only or with
    `l10n.ar`), `crmDesignData(found)` (literal, else an endpoint design's `crm-defaults`); `htmlCrmContractOf` adds
    `defaults` (first `<script type="application/json" id="crm-defaults">` JSON object ≤ `CRM_DEFAULTS_MAX` 512 KB,
    only without a literal), `version`, `manifest`. `isOwnDesign` is false on v2; `mergeCrmContract(d, crm, {locale})`
    on v2: no own-design fallbacks (D1 everywhere), `short_name` = the spa's website content (any value / language),
    else the CRM name (v1: `namesSpa`); `logo_on_dark` = the content, else the CRM logo; `logo_on_light` = the CRM
    logo, else the content (the design's own logo defaults never show); `locale` as the last key (v2 and `design:
    null` only; v1 JSON unchanged — snapshot test). html-content.ts: reserved roots `contract` / `locale` (never slots,
    overlays or leftovers); on v2 `spa.short_name` / `spa.logo_on_light` are slots; `overlayHtmlContent` resolves
    English-only paths in English and, on `/ar` of a v2 design, **content Arabic > `l10n.ar` > content English >
    design English** (integrator decision 2026-10-13, contract doc §4; texts + tags; `spa.short_name` keeps the spa's
    English), and records the paths it set on its output (`markHtmlContentPaths`, a WeakMap the merge reads);
    `contractLocaleData(data, 'ar')` writes `l10n.ar` into matching text / tags slots copy-on-write (same object for
    en / v1 / no l10n); leftovers on v2 name no spa and skip system copy; `htmlContentView` reads `crmDesignData`.
    `carryHtmlContent(old, newData, newHtml, oldHtml?)`: values by remapped path (`[n]` → the item id when the new
    array has ids) + same kind; page texts / pictures re-pointed by id family + `src` (equal ones paired by their
    position in `oldHtml`, else in id order; extra → `ambiguous`); a text the new file binds with `data-crm-text` to a
    text slot → that value (Arabic kept, missing English from the design; a set value wins → `duplicate`), never a
    fragment (`part`: the listing's `pathPart`) nor one missing the slot's single-brace `{tokens}` (`tokens`); every
    drop listed (`gone` / `kind` / `bound` / `ambiguous` / `duplicate` / `part` / `tokens`, ≤ 80 chars); output passes
    `htmlContentErrors`. `htmlDesignOwnPins(oldData, newData, tenant, keep)`: own v1 design → v2 only; v2 slots whose
    v1 value differs → content (`data:image` → `files` for the caller to store), never `ui.*` / contract /
    operational / kept paths, `short_name` only when it names the spa; a v1 text equal to the v2 default once
    `{city}` / `{area}` / `{spa}` are filled with the v1 design's values is not pinned. html-design.ts:
    `HtmlDesignText.path` (own or inherited `data-crm-text`; per attribute from `data-crm-attr="attr:path; …"`),
    `pathPart` (a run of a `data-crm-text` element with several runs or `data-crm-tpl`); ids / bindings unchanged
    (snapshot). html-report.ts: `htmlDesignReport(html)` (contract none / v1 / v2, mode, locales, slot counts by kind
    + `ui`, page texts total / editable / crm / script / with a path, pictures, ≤ 20 warnings: not-json,
    locale-in-data, no-ids, staff-no-photo-guard, named-spa, contact-in-defaults, logo-in-defaults (v2), fixed-title,
    no-arabic-font, bound-no-slot, ui-kind, no-ui, defaults-too-large, embeds; never throws, ~50 ms on the 4.6 MB BE
    RELAX file) + `htmlDesignReportLine`.
    **Template versions, live rollout, D5 (P5, platform; owner D4 + D5):** `site_templates.version` / `history`
    (`TemplateVersionEntry[]`, newest first) / `pending` (`PendingTemplateVersion`: pages + report; invisible to apply,
    the catalog reads `pages`), migration 0052; `sites.text_run` (`SiteTextRun`) / `template_hold` (`TemplateHold`);
    `TemplateUndo.live` + pages `publishedBefore` / `draftVersionId` / `draftSavedAt` (jsonb). Services
    `site-templates.ts`: `templateDocOf`, `templateShas`, `templateVersionEntry`, `setPendingTemplateVersion`,
    `discardPendingTemplateVersion`, `signOffTemplateVersion` (one transaction; pending → pages, the old one →
    history; the update is conditional on the pending sha = the reviewed one and an unchanged version, else refused
    "changed meanwhile"), `pushTemplateVersion` (a "Replace" upload of an HTML row: the replaced file becomes an older
    version). `template-rollout.ts`: `spasOnTemplateVersions` (platform role: newest published HtmlDesign of each
    visible page; `template_key` = key or live sha ∈ old shas; ONE `RolloutSpa` per spa with `pages` (every page on an
    old sha: content, images, phoneFixes, `own` = `isOwnDesign` of the old template file's data, hasDraft) /
    `current` (spas only on the new sha) / skipped `changed` (no page on an old sha, another live sha — never
    overwritten) · `not-live` · `held` (hold for key, ≥ version)), `templateRolloutCounts` (list page; distinct spas),
    `upgradeHtmlDesignLive(tx, tenant, {pageIds, …})` (spa tx: lock + editor lock on every page (`locked`), pages
    whose live sha ∈ old shas else `already` / `not-on-version`; all of them in one savepoint (`UpgradeSkipped` rolls
    it back: nothing written): per page the new file copied in (`prepare`), `upgradedProps` (block id + other props
    kept; Phone fixes / adjustments equal to the old version's (`fromProps`, only inherited) follow the new version,
    the spa's own are kept: Phone fixes on, adjustments re-pointed by `src` and kept where the new version sets none — site-kit `html-images.ts` `repointHtmlImageAdjustments` / `mergeHtmlImageAdjustments`), content =
    `carryHtmlContent` + `htmlDesignOwnPins` (embedded logos sniffed → the spa's `html_design` files `/files/{id}`),
    `htmlContentErrors` + `htmlDesignContentErrors` else `invalid`; `insertVersion` published row (never
    `publishPage`: draft theme + pending rename stay), the working draft carried (same old file) or kept and moved
    after it (unlabelled old row deleted, a labelled one stays); then ONE `templateUndo.live` holding every page and
    (v2) ONE `queueSiteTexts` with the pages whose old design was not the spa's own (all own → `skipped` "made for
    this spa"; no AI gate → skipped with the reason); result `pages[]` + totals). `sites.ts`: `insertVersion`, live branch of
    `templateUndoChanges` (published row still the upgrade's; newest = it or the carried draft with its stamp) and
    `undoTemplateSwitch` (draft dropped, `publishedBefore` re-published as a new row, the old draft back, hold set),
    `switchWrote` / `keepTemplateUndo` (a Write texts save over what a switch wrote keeps undo: no label, stamps
    moved), `queueSiteTexts` / `skipSiteTexts`, exported `latestVersion` / `preparedPages`. `html-design-report.ts`
    `pageDesignReports` (newest version's design per page, cached by tenant + file + sha). Write texts moved to
    `@spa/ai` `site-texts.ts`: `runSiteTexts` (the R23/P4 loop; `pageIds` / `htmlOnly` / `onlyDefaults` (site-kit
    `htmlTextSlots`: the spa's own values and texts left, leftovers kept; an English-only own value — leftover
    reason `arabic`, not an English-only contract field; on translated system copy in either mode — is an
    `TextSlot.arabicOnly` slot right after the leftovers: the prompt marks it `arabic_only`, `fillTextSlots` keeps the
    stored English and writes only the Arabic) / `keepUndo` / `designSha` / `schema` /
    `signature` / `client`; never audits), `runQueuedSiteTexts` (atomic claim `queued → running` on `text_run`, gate
    re-checked for the queuing super-admin (SITE_AI_EDITOR_EMAILS + 2FA) + ModelArk or a client, audit
    `site.ai_texts_written`, `done` / `failed` / `skipped` + summary), `sweepSiteTexts` (worker `site-texts-queue`
    every 2 min: queued > 3 min, running > 15 min requeued, ≤ 3 a tick), `siteTextsRunning` (globalThis set). System
    copy (`systemCopy`) is never a Write texts slot (only `arabicOnly` for the spa's own English); a draft losing a single-brace `{token}` of the design's English
    is skipped (HTML slots only). Web: `server/site-texts-queue.ts` (`siteTextsGate`, `runQueuedTextsAfter` =
    `after()`); console `files/templates?kind=version&id=` (pending version + report, audit `version_uploaded`),
    `kind=html` reply / audit carry `report`; templates page: per HTML row "Upload new version", pending line + Preview
    (`/templates/{id}/preview?version=pending`, EN / AR) + Roll out (`rollout-sheet.tsx`: `rolloutPlanAction(id,
    later)` carry dry run per spa (pages, kept / not kept, keeps phone fixes / picture adjustments) + `look` (a pending
    version's Phone fixes / adjustment differences), `rolloutTemplateVersionAction` = sign-off + spas until 25 are
    switched or `ROLLOUT_BUDGET_MS` 30 s (skips don't count; returned `later` tenant ids go last on the sheet's next
    click), each spa in its own `withTenant`, audits `site.template_upgraded` (pages) / `version_signed_off` /
    `version_rolled_out`, then `after()` Write texts) + Discard; `HtmlFileField` shows `htmlDesignReport`
    (`DesignReportPanel`) and, in "Upload new version" (`current`), prefills the current version's Phone fixes and
    adjustments re-pointed at the chosen file (`version-prefill` line). Spa website page: Pages card badge "CRM
    contract v2" / "CRM contract" / "Not connected to the CRM" + report line + warnings (+ a connector prompt to
    convert), the D5 run line; Undo bar for `live`; `applyTemplateAction` queues D5 for the v2 pages it wrote in the
    switch's own transaction (`queueAppliedTexts`: reads in a savepoint, a failure → skipped line; `after()`);
    connector `apply_template` queues it in its switch transaction too (worker sweep). Video: `/files/upload?kind=video`
    body cap 8 MB + 64 KB and the video 413 text; `SlotVideo` "Upload video"; draft saves / the op refuse a picture
    file in a video slot and a video in a picture (`wrongKindContentFiles`). Tests: services `template-rollout.test.ts`
    (+ two-page spa: one undo / one run, all-or-nothing, `wrongKindContentFiles`, `upgradedProps`), ai
    `site-texts.test.ts` (+ `arabicOnly`, `sweepSiteTexts`), e2e `html-rollout.spec.ts` (fixtures `r28-v1.html` /
    `r28-v2.html`, excluded from Biome; D5 line read `filter({ visible: true })`: DataTable renders the page cell twice).
  - **Fill the CRM from the design (R28 P3):** core `html-crm-seed.ts` (`crmMatchScore`, `designSeedPairs`, pair ≥
    `SEED_MATCH_MIN` 0.5) · services `catalog.ts` (`saveService` / `setServiceImage` / `setStaffPhoto` +
    `NEW_SERVICE_DEFAULTS` / `IMAGE_URL_PATTERN`: the rules the CRM's own service + staff actions use) ·
    `design-seed.ts`: `designSeedSource(tx, tenant, page?)` (the DRAFT design's CRM_DATA literal + `designSeedHash`),
    `designSeedPages` (pages whose draft has the literal; cached per tenant + file + sha256), `planDesignSeed` (read
    only; active services / therapists), `applyDesignSeed` (advisory lock per spa; only ACTIVE services are filled or
    matched — "create" fills an active same-name one instead of a duplicate; pictures = the design's `data:` images
    → `processImage` → media library tagged `design` + `design:{sha8}`, reused on a re-run), `designSeedThumb` (96 px
    WebP previews made on the server). Console: `websites/[slug]/seed-actions.ts` (`seedGuard` = `site.design` +
    `services.manage` + `staff.manage`; the apply carries the preview's hash and is refused when the draft changed) +
    `seed-sheet.tsx` (Pages card "Fill the CRM", offer bar after applying an HTML template via `?seed=`; the offer is
    looked up after the template switch commits). Connector `plan_design_seed` (read only; therapist names only for
    those shown on the website). Branch `area_label` (0051, `cleanAreaLabel` ≤ 80 each; Arabic-only = `{en: '', ar}`)
    → `crmFeedFacts` → `buildCrmContract` (`area_explicit`: the branch's own label wins over the design's).
  - **Legacy designs (pre-R24 uploads):** R17 stored `fixHtmlDesign(raw)` (viewport + fluid widths baked into the html);
    `htmlDesignBakedFixes` (no switch value and inline html, or `bakedFixes: true` kept after the switch was used):
    the row switch says "old upload: re-upload to show exactly" and Off's message says to upload the original again.
  - Residual (a sandbox must forbid; the root fix — a separate design domain without CSP sandbox — needs an owner
    decision + a domain): storage lasts per page view, cookies never reach a server, no IndexedDB / Cache API / service
    workers, outside fetches send `Origin: null`, camera/mic/geolocation/payment stay off, `self.origin` is `'null'`;
    **frames inside a design inherit the sandbox** (opaque origin: YouTube / Vimeo players, Calendly / booking widgets,
    Instagram / TikTok embeds, Google Maps may stay blank or lose features — static and data:/srcdoc frames render; the
    upload / connector warn). Frames additionally: phone toolbar never collapses, a phone never zooms out a design
    wider than the screen (the platform page around it isn't), `location` = the shell, prints one viewport, sensors off
    on preview pages.
  - E2E: `html-fidelity.spec.ts` (fixture `e2e/fixtures/fidelity.html`, windows-1252, rebuilt by `make-fidelity.mjs`:
    raw file at `http://design.test/` (its own bytes, no header charset) vs live page / Studio preview / template
    preview, 0 pixels off by > 24 (measured 0 everywhere; counts printed) + computed styles (incl. header link colour, fixed button font,
    srcset density, Latin text, script-time image read, nested srcdoc frame, `<object>` SVG, data: fetch, mailto form),
    1440×900 + 390×844 (phone frames vs a non-zooming 390 window, see Frames above), scroll 0/600/1500/bottom/anchor;
    nested frame origin `null` = the documented residual; Phone-fixes negative control), `html-upload.spec.ts` (4.6 MB
    design stored + served byte for byte, spa copy private, live page body = the file from `<body>` on, windows-1252
    upload, 5 MB client message, 413 JSON, JSON 2 MB), `templates.spec.ts` "HTML design upload" / "HTML design images".
- **Map links (owner, 2026-10-09)**: every rendered branch address links to Google Maps (new tab, label "Open in Google
  Maps" EN/AR via `ui('openInMaps')`, `data-maps-link`): contact/hours block, footer, placeholder site, booking page.
  Target = `branchMapsHref` (`@spa/core/maps.ts`): `branches.maps_url` (exact pin; `normalizeGoogleMapsUrl` =
  explicit host allowlist google.com|ae/maps…, maps.google.com|ae (/ or /maps…; no /url redirector), maps.app.goo.gl,
  goo.gl/maps; no whitespace/quotes/backslash/<>/backtick; the actions store `URL.href` (RFC 3986 chars only), never
  the raw paste; re-checked on read) else an address search. Site: `mapHref(meta)` / `addressLinkProps(meta)`
  (`links.ts`). HTML designs: `{{map_url}}` = same target; `{{address}}` in plain text becomes an escaped
  `<a data-spa-map>` — text positions come from a quote-aware tokenizer (`linkableTextRanges`; `>` inside attribute
  values doesn't end a tag), never inside comments, `<a>`/`<select>`/`<button>` or raw-text elements (script, style,
  title, textarea, xmp, plaintext, iframe, noembed, noframes, noscript); `escapeHtml` also escapes `\` and `` ` ``.
  - **Placeholder escaping by context (R24 review, `fillSpans` + `jsScan`/`cssScan` in html-design.ts):** quoted
    attribute / RCDATA / text = `escapeHtml` (after a bare `<` the first letter as a reference); unquoted value or tag
    outside values = also space, `=` → `&#n;`; JS (script body, `on…`, `javascript:` href/src/action/formaction/
    xlink:href) inside a string = JS-string text (`{` too, never `${`; URLs also `%`), outside a string = a quoted
    JSON string literal (`/`, `*` escaped: safe in comments / regexes), then HTML escaping for attributes; CSS (style
    body / attribute) inside a string = CSS-string escapes, outside = every non-alphanumeric hex-escaped. Lexers are
    heuristics (regex after a value = division); comments / non-JS script types never filled.
  Tests `packages/core/test/maps.test.ts`; E2E: `site.spec.ts`.
  - Transforms are pure in `@spa/core` `html-design.ts` (tests `packages/core/test/html-design.test.ts`):
    `htmlDesignDocument(html, values, inert, images, links, { phoneFixes, top })` (see above; with phone fixes: viewport
    if missing + `HTML_DESIGN_BASE_CSS`, all `:where()`, first in <head> so the design's rules win); `fixHtmlDesign` = the
    same fixes (viewport, inline img `width:Npx` > 360 → `width:100%;max-width:Npx`), only reported in the upload message
    now; `listHtmlDesignImages` ids = `img-<n>` (n-th `<img>`) /
    `bg-<n>` (n-th `background(-image)` url in `<style>` + inline styles; scripts/comments/fonts skipped).
  - Adjustments = block prop `images: HtmlImageAdjust[]` ({id, src (first 300 chars, must still match), fit, x, y,
    align, replace}); applied by `applyHtmlImageAdjustments`: framed only when fit / x / y / align is set
    (`htmlImageFramed`, R28 P4): `data-spa-img` attr + `!important` rules at the end, background position/size
    appended after the declaration; a replacement alone only swaps the URL; replace URL must match `HTML_IMAGE_URL`
    (https or site path; `$` allowed, character references refused (a pasted `&amp;` is read as `&`); inserted by replacer functions, `&` escaped in src / srcset /
    style attributes, not in `<style>` bodies; srcset dropped; inside `<picture>` every `<source srcset>` takes it too); of several entries
    with one id the last whose src still matches applies. UI `templates/html-images.tsx` (`HtmlFileField` in the upload sheet reads the file
    client-side; `HtmlImageAdjuster` with 360/1280 sandboxed preview, honours Phone fixes); saved with the upload (hidden
    `images` JSON, remapped to the moved URLs) or `saveHtmlImagesAction` ("Images" row button, `updateStudioTemplate`
    takes `pages`).
    Replacement uploads go into the chosen spa's media library (`/files/upload`, normal size cap; public files, so
    they break if that spa is deleted). E2E: "HTML design images".
- **Website Studio (R23, console)** (PLAN §14.8 R23): `platform/(console)/websites/page.tsx` lists every spa
  (services `site-studio.ts` `websiteOverview` = platform read, deleted spas out; `websiteProgress` status none →
  template → draft → live + `unpublished` + next step; `next-step.tsx` button; nav badge = open change requests;
  `listChangeRequests` puts open ones first, so its limit never hides one the counts include).
  `websites/[slug]/page.tsx` (+ `cards.tsx`, `website-client.tsx`) = everything of the studio; actions in that folder
  (`actions.ts`, `studio-actions.ts`, `blog-actions.ts`, `import-actions.ts`, `write-texts-actions.ts`,
  `editor/*-actions.ts`) are `studioGuard`ed and refresh both sides via `server/studio.ts` `revalidateStudio`;
  paths `lib/paths.ts` `studioPath`, absolute `server/studio.ts` `studioUrl`. Editor + preview: `platform/(studio)/
  websites/[slug]/{editor/[pageId],preview}` ("Back to console"; preview shared with the CRM via
  `components/site/draft-preview.tsx`); English-only text provider `components/site/studio-i18n.tsx` for the shared
  media/image fields. No review step: `sites.studio_status` is deprecated (kept for zero-downtime deploys, never read).
  - Spa members (`dashboard/[tenant]/website/page.tsx`, `site.content` or `services.manage`): preview of their site
    (`/website/preview?live=1` = published, else the draft), `ServicesPrices` (`services-prices.tsx`, menu-only
    `ServiceSheet`), **Request a change** (`request-change.tsx` → `request-actions.ts` `requestChangeAction`, audited
    `site.change_requested`; refused when read-only) + their requests with status/note. Console "Mark done" =
    `resolveChangeAction`. Super-admins opening `/{slug}/website`, `/website/editor/{id}` or `/website/blog/{id|new}`
    are redirected to the console (id checked first, built from the stored slug with `adminUrl`); members get 404 there.
  - **Write texts** (`write-texts-actions.ts` `writeTextsAction`, sheet `WriteTextsSheet`): `server/site-ai-gate.ts`
    `siteAiGuard` (= studioGuard + `siteAiEditorStatus` ok; Ask AI uses it too) + `aiEditReady`; one run per spa;
    ≤ 12 pages, slots = `@spa/services/site-kit` `textSlots` (every non-empty `bi` prop incl. lists/objects/slots;
    alt texts, HTML-design pages, GlobalSection out; `multiline` from the field's AI meta) → `@spa/ai` `planSiteTexts`
    (agent `site_editor`, facts from `loadSiteFacts`: brand profile, active branches, public menu with hidden prices
    as "price on request"; ≤ 40 slots per call, 2 at a time, ≤ 24 calls, 150 s) → per page in its own tx: `lockSite`,
    `assertPagesUnlocked` (locked pages skipped up front too), `fillTextSlots` (only seen keys whose EN is unchanged;
    `plainText` strips tags/control chars, caps 200/1500 code points), `designSignature` must not change, the unnamed
    working draft is labelled "Before Write texts {Dubai time}", `saveDraft`; a page whose save fails is reported
    "could not be saved — run again" and the run goes on. Each AI call gets the run's 150 s `AbortSignal` (through
    `runChat` → ModelArk fetch). Never publishes; audit `site.ai_texts_written`.
    Tests `packages/services/test/site-text-slots.test.ts`, `packages/ai/test/site-edit.test.ts`, e2e
    `console-website.spec.ts` (fixture slug `texts-editor`). Replaced the old "Write with AI" sheet
    (`server/site-writer.ts` and the services site-copy helpers `applySiteCopy*`/`extractSiteCopy` removed).
- **Saving and publishing**:
  - Draft JSON is capped at 512 KB.
  - Design changes need `site.design` (checked via `designSignature`).
  - Preflight runs before publish (`server/site-preflight.ts`); errors block publishing, warnings don't.
- **Site-edit ops layer** (`@spa/services` `site-edit.ts`, shared by Ask AI and the Claude MCP connector): `runSiteEdit`
  (zod op shapes → per-page `applySiteEditOps` against the block schema the caller passes, all-or-nothing, `dryRun`,
  `base` = editor canvas data; writes `saveDraft` / `addPage` / `renamePage` / `updateDraftTheme`; `check` callback =
  caller policy), `restoreSiteEdit`, `getSiteForEdit`, `blockCatalogue`, `siteEditAuditData`. Edit ops accept `index`.
  Drafts only: `sites.theme_draft` (`editingTheme()`; editor, previews and preflight use it; `loadSite({published:
  false})` swaps it in) and `site_pages.pending` (rename of a live page); `publishPage` applies both.
- **Editor session (F29)**: autosave + local copy + editing lock. Client: `components/site/editor/session.tsx`
  (`useEditorLock`: take on open, heartbeat 30 s + on tab visible, view-only polling, `pagehide` release; local copy
  `spa-editor-draft:{slug}:{pageId}` in localStorage; status text + Lock / Conflict / Restore banners as
  `region`s) wired in `editor/[pageId]/editor.tsx` (`persist('auto'|'manual'|'overwrite')`: debounce `AUTOSAVE_MS`
  2 s, flush on window blur (not into the canvas iframe) / tab hidden, offline → local copy + retry on `online` /
  15 s; paused while an Ask AI plan is previewed — `AiEditPanel onPreview`). Conflict = reply key
  `errors.domain.editedElsewhere` (Keep mine = `saveDraftAction(…, { overwrite: true })`, audited
  `overwroteChangesElsewhere`); lock refusal = key `errors.domain.pageLocked` (→ view only). Server: `editor/lock-
  actions.ts` (`editorLockAction` take/heartbeat/take over → audit `site.page.lock_taken_over`,
  `editorLockStatusAction`, `releaseEditorLockAction`); the editor page reads the holder (read only, so a prefetch
  never locks) and opens view-only. Services `site-locks.ts`: `site_page_locks` (unique page, RLS), `acquirePageLock`
  (atomic upsert with `setWhere`: ours / expired / take over), `getPageLock`, `pageLocksHeldByOthers`,
  `assertPagesUnlocked` (`PageLockedError`), TTL 2 min. Checked (before the edit stamp, so a taken-over editor gets
  `pageLocked`, not "changed elsewhere — keep mine") in `storeDraft`, `publishPageAction`,
  `restoreVersionAction`, `runSiteEdit` (changed + renamed pages, dry runs too) and `restoreSiteEdit`; MCP `get_site`
  shows `editing` per page. Autosave audits once per page + editor per 10 min. E2E: `editor-session.spec.ts`.
  Unsaved baseline: taken 400 ms after load, always from Puck's first history entry (the loaded page as normalised),
  never the canvas: an edit made before the timer still autosaves, even one Puck's 250 ms history debounce hasn't
  recorded yet (the CI take-over race, 2026-10-10). Publish waits for an autosave in flight and no autosave starts while
  publishing (server actions run one at a time: a queued publish would carry the pre-save stamp → "changed elsewhere").
  Take over reloads the page
  (`reloadEditor` → `window.location.reload`).
- **Import from existing website (F32)**: Studio Pages card → console `websites/[slug]/import-sheet.tsx` → `import-actions.ts`
  (`studioGuard(…, 'site.design')`; preview = crawl + map + `runSiteEdit` dry run; apply = only `add_page` + add /
  preset / update root on that page, used photos downloaded outside the tx, then `saveImportImages` + `runSiteEdit`
  in one tx). Services `site-import/`: `safe-fetch.ts` (SSRF guard: http(s), ports 80/443, no credentials, every
  resolved address public via `isPrivateAddress`, socket pinned to the checked address through a custom `lookup`,
  redirects re-checked, decompressed size cap, deadline; `allow` / `isBlocked` / `ports` = test seams),
  `robots.ts` (RFC 9309 groups, longest match, `$`/`*`), `extract.ts` (quote-aware tokenizer; skips script/style/
  nav/form/svg/hidden; JSON-LD business + offers; services/prices/durations incl. table rows and Arabic digits; hours;
  contact; photos incl. og:image, lazy/srcset, inline backgrounds; `linksToFollow`), `ops.ts` (`mergeImportPages`,
  `buildImportOps` with `/files/import-image-N` placeholders, `resolveImportImages`), `index.ts`
  (`crawlSiteForImport`, `fetchImportImage`, `saveImportImages`). AI mapping: `@spa/ai` `planSiteImport` (agent
  `site_editor`, imported content marked as untrusted data; only add / preset / update root kept; invalid AI ops →
  standard layout). Playwright only: `SITE_IMPORT_E2E_ALLOW=127.0.0.1:<E2E_PORT+1>` exempts the fixture server (never
  set in deploy env). Tests: `packages/services/test/site-import.test.ts` (SSRF incl. DNS rebinding + redirects,
  robots, extractor fixture `test/fixtures/spa-site.html`, ops → draft page), `packages/ai/test/site-edit.test.ts`,
  e2e `site-import.spec.ts`.
- **Ask AI (R16, studio editor only)**: header ✨ panel (`components/site/editor/ai-edit.tsx`) → `editor/ai-edit-actions.ts`.
  Gated by `SITE_AI_EDITOR_EMAILS` (`server/site-ai-gate.ts` `siteAiGuard` → `siteAiEditorStatus` in `@spa/db`
  admins.ts: `*` = super-admin + 2FA like the console; a named list = listed + verified email + super-admin + 2FA; read fresh; statuses ok / not_listed / unverified / not_admin / needs2fa, each with its own message incl. the OAuth consent page) on every action; the panel says "not enabled" otherwise. Plan + Apply run through the ops layer
  (Apply re-runs the previewed ops on the same base); theme ops → draft theme; last 5 applied changes listed, Undo
  reverts the newest.
  - Plan: `planSiteEdit` (`@spa/ai` agent `site_editor`, model from `ai_model_config`, metered + budget) gets the
    instruction, the trimmed page (`trimPageForPrompt`: ids/types/props, page text marked as data) and the vocabulary
    from `siteEditSchema()` (`components/site/ai-schema.ts`: built from the Puck config — custom fields carry
    `ai` meta in `field-defs.tsx` — plus `SECTION_PRESETS` and theme tokens; GlobalSection, custom CSS and
    schedules excluded). Output = ops (add / preset / move / remove / update incl. `{en,ar}` + per-device / theme).
  - `applySiteEditOps` (`@spa/services/site-kit/edit-ops.ts`, pure): validates every op against that schema
    (unknown block/prop/option/id or disallowed slot ⇒ the whole plan is rejected), applies to a copy.
  - Preview on the canvas (Puck `setData` + theme state), then Apply = draft save (512 KB cap, `designSignature`
    ⇒ `site.design`; theme ops update `sites.theme`, live like the Theme panel) → audit `site.page.ai_edit`;
    Undo restores the previous draft + theme (`site.page.ai_edit_undone`). Never publishes.
  - E2E: `AI_E2E_FIXTURE_DIR` (Playwright only) makes the action answer from `<dir>/<slug>.json` via
    `server/ai-fixture.ts`, still through the real gateway (`mockAiReply` helper, `ai-edit.spec.ts`).
- **Share preview**: an HMAC token signed with `BETTER_AUTH_SECRET`, valid for 1, 7 or 30 days, opened at
  `/website/preview?token=` on the app host.
- **Analytics**:
  - `public/t.js` is cookieless. It sends pageviews, a `block_view` when 40% of a block is visible, and
    WhatsApp/Instagram/booking clicks.
  - `/api/collect` caps bodies at 4 KB, allows 240 requests/min per IP and uses a daily-salted session hash.
  - Events land in `web_events`, are rolled up hourly and pruned after 90 days. `source` = core `webEntrySource`
    (`?src`/`utm_source` tag, known referrer, referrer host, `direct`).

## Client IP (F26, G6)

- One source: `@spa/core` `client-ip.ts`. `clientIpFrom(headers)` reads only `CLIENT_IP_HEADER` (`cf-connecting-ip`,
  which Caddy overwrites on every request: deploy/droplet/README.md "Client IP"), returns null unless it's a single
  valid IPv4/IPv6 (dev/e2e without Caddy → null). `ipRateLimitKey(ip)` = rate-limit bucket: IPv4 (and IPv4-mapped)
  as is, IPv6 by /64, null → `unknown`; Better Auth's limiter uses the same header and `ipv6Subnet: 64`.
- Callers: web `server/rate-limit.ts` `clientIp()` / `withinIpLimit` (signup, admin join, contact), booking
  `bookOnline` in-memory limits, `/api/collect` + `/api/client-error` limits, `audit()` IP, intake signature IP,
  enquiry `ipHash` (null without IP; also website enquiries, F15), Turnstile `remoteip`, auth MCP consent audit. `packages/core/test/client-ip.test.ts`
  fails if any `apps/*/src` / `packages/*/src` file names an IP header itself.

## Bot check (F9, Cloudflare Turnstile)

- Client `components/turnstile.tsx` `useTurnstile(siteKey, action, lang)`: explicit render, managed +
  `interaction-only`; `getToken()` before submit (waits ≤ 30 s, '' at once when the script is blocked/errored),
  `reset()` after every non-ok answer (single-use tokens). Server `server/turnstile.ts`: `turnstileSiteKey()` for the
  page, `passesBotCheck(token, action)` in the action (siteverify + `clientIp()`); both skip when keys are unset or on
  a custom domain without `TURNSTILE_CUSTOM_DOMAINS=on`. Used by `bookOnline` (booking page + widget iframe, action
  `booking`), `signupAction` (`apply`, after the IP limit, before the login is created), `sendEnquiryAction`
  (`contact`) and the website enquiry form `sendSiteEnquiryAction` (`enquiry`, F15). Honeypots + per-IP limits stay. R26: the HTML design endpoint `{site}/crm-enquiry` has no Turnstile (the design runs sandboxed and can't
  show the widget), so it answers only for spas whose live site has a contract design (404 otherwise): honeypot,
  per-IP + per-spa limits, the Origin check (Origin required), the JSON content type and server-side id resolution
  stand in. e2e runs with Cloudflare's always-pass test keys (playwright.config);
  `online.spec` also covers a blocked script → refused. CSP (F10) allows `challenges.cloudflare.com` (script + frame) on
  marketing/app/site/domain pages, not the admin console.
- Keys from the console (owner, 2026-10-09): console Company page → "Bot check (Cloudflare Turnstile)" card
  (`saveTurnstileSettingsAction`; services `turnstile-settings.ts`, `platform_settings.turnstile_*`): site key visible,
  secret write-only (`…last4`, sealed with `sealEmailKey`, never audited/logged), "Also check spa custom domains" switch
  (null = env). Core `resolveTurnstile(saved, env)`: each value console first, then env; `turnstileStatusText` feeds the
  Configuration row ("from console/env", or which key is missing). Web `server/turnstile.ts` caches the console values
  30 s per process (`invalidateTurnstileSettings()` on save); `turnstileSiteKey()` is async. E2E: `security-headers.spec`.
- **Staff email (Resend) from the console:** Company page → "Email (Resend)" card. Key + From: `saveEmailSettingsAction`
  (services `email-settings.ts`: key sealed with `sealEmailKey`, write-only, `…last4`; never logged/audited), core
  `resolveEmailConfig` (console, then `RESEND_API_KEY`/`EMAIL_FROM`, then `DEFAULT_EMAIL_FROM`), web
  `server/email-settings.ts` registers the cached console source; "Send test email to me" = `sendTestEmailAction`.
  **Sending domain (R18):** client `settings/sending-domain.tsx` → `sendingDomainAction` (intent `setup` | `check`,
  optional one-off `setupKey`): core `resend-domains.ts` against Resend (docs checked 2026-10-10, URLs in its header):
  setup = list (all pages) → create `{name, region: eu-west-1}` only when missing → get; check = get → verify unless
  verified or pending (read first: verify resets the status to pending, hiding the last result and which records
  failed) → message names the last result; never adds on check. Records → Namecheap rows (`namecheapHost`: relative host, `@` for the
  apex), rendered from the action result (no table). Errors → plain text (`restricted_key` (401 restricted_api_key /
  invalid_permission) → the section shows "Full-access key for setup" via `fieldErrors.setupKey`; `invalid_key`,
  (also Resend's live 400 validation_error "API key is invalid"; under the setup field when that key was refused),
  `rate_limited`, `unreachable`, `domain_taken`, `not_set_up`, `failed` = Resend's message with any `re_…` scrubbed).
  The key never reaches the client, an error, a log line or an audit row (`platform.email.domain_setup` {domain,
  created, status}, `platform.email.domain_checked` {domain, status}). E2E: `RESEND_E2E_FAKE` (playwright.config only)
  swaps in `server/resend-fake.ts` (in-memory Resend behind the real client; "SendOnly" keys = sending access; verify → pending, next read verified);
  `email-settings.spec`.

## Security headers (F10, G11)

- Pure builders in `@spa/core` `security-headers.ts` (tests `packages/core/test/security-headers.test.ts`):
  `pageKindOf(internalPath)` → surface (marketing/app/admin/site/domain) + `embed` (only `/{site|domain}/x/book/embed`),
  `contentSecurityPolicy`, `pageSecurityHeaders`, `newNonce`, `API_CSP`, `htmlDesignFrameCsp`, `parseCspReports`.
- **Pages** (everything `proxy.ts` matches): proxy makes a 128-bit nonce per request, puts the CSP on the response and
  on the request (Next reads the nonce from the request CSP and stamps its own scripts/chunks) plus `x-nonce` for ours
  (`server/nonce.ts` `getNonce()`: root layout `scenes-on` bootstrap, dashboard early-prompt listener, marketing + spa
  JSON-LD). The root layout reads it, so every page renders per request (nonces can't be prerendered).
  Policy: `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'` (+ Turnstile origin outside the admin
  console; + `'unsafe-eval'` on `next dev` only) — Next chunks, `t.js` (next/script), Turnstile load via strict-dynamic;
  `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `font-src 'self' data:`; `connect-src 'self'`;
  `frame-src 'self'` (+ Turnstile; + www.google.com, www.youtube-nocookie.com, player.vimeo.com on site/domain/app for
  the F15 Map/Video players — `SITE_EMBED_ORIGINS`; on the admin console only for the Website Studio pages
  `/platform/websites/{slug}…`, `PageKind.studio`, R23); `worker-src`/`manifest-src 'self'`; `object-src 'none'`; `base-uri 'self'`;
  `form-action 'self'`; `frame-ancestors 'self'` (embed: `*`); `upgrade-insecure-requests` on https;
  `report-uri /api/csp-report?s={surface}`. Also `X-Frame-Options: SAMEORIGIN` (not embed), COOP `same-origin`
  (dashboard: `same-origin-allow-popups`, the outbox reuses one named WhatsApp tab), HSTS on https only
  (`includeSubDomains` on platform hosts, not on spa custom domains).
- **Decisions:** style-src keeps `'unsafe-inline'`: React renders `style` props as attributes (theme colours, Puck
  per-device overrides), and Radix (scroll lock), Puck (copies styles into its canvas iframe) and Turnstile insert
  `<style>` without a nonce; a nonce in style-src would disable `'unsafe-inline'`. CSS can't run script and img/font/
  connect-src limit what it can load. img-src `https:`: image fields accept any https URL (AI images, pasted links,
  Instagram/Google media); stored files are served by the app (`/files`), never from the S3/R2 host. Stripe Checkout
  and OAuth (Google, Meta, MCP consent) are top-level navigations, not form posts, so `form-action 'self'` holds. Puck
  needs nothing extra: both editors import `components/site/editor/puck-css.ts` first (Puck's `no-external.css` + the
  `--_puck-styles-loaded` flag set before Puck renders; otherwise Puck injects its own copy, which `@import`s rsms.me's
  Inter — the editor uses local Inter Variable). Zod in the browser is jitless (`lib/zod-jitless.ts`, imported first by
  `components/campaigns/rules.ts`): its JIT probes `new Function`, which the CSP blocks and reports.
- **Permissions-Policy** (`PERMISSIONS_POLICY`: camera, mic, geolocation, payment, usb, serial, hid, midi, sensors,
  display-capture, browsing-topics off): pages get it from the proxy (`pageSecurityHeaders`), `/api`, `/.well-known`,
  `/files` from next.config — never both (R24: a second policy would undo a delegation). The direct HTML design page
  and the design shell (`permissionsPolicy({ design: true })`) leave the motion sensors undeclared (browser default =
  the design may use them, as when opened directly); preview pages keep them off for their frames.
- **R26 contract endpoints** (`{site}/crm-data.json`, `{site}/crm-enquiry`; core `crmFeedPath`): proxied but
  rewritten with `apiSecurityHeaders` (`API_CSP`, XFO DENY, Permissions-Policy, HSTS as the site) instead of the page
  headers; no nonce, no exact-design lookup; CORS `*` set by the route (also on the R20 / F23 301 of crm-data.json).
- **Not proxied** (`next.config.ts` headers): every path gets nosniff, `Referrer-Policy: strict-origin-when-cross-origin`;
  `/api/*` + `/.well-known/*` get `API_CSP` (`default-src 'none'; frame-ancestors 'none'; …`) +
  `X-Frame-Options: DENY`; `/files/*` keeps its own sandbox CSP (`app/files/serve.ts`) + XFO SAMEORIGIN; HSTS (no
  includeSubDomains) on those when `x-forwarded-proto: https`. Never set CSP/XFO/HSTS there for a proxied path (a
  second CSP is enforced too; only the first HSTS counts). `/api/html-design/frame` sends its own CSP (excluded).
  Public `/files` responses carry `Access-Control-Allow-Origin: *` (R24; private ones never).
- **Reports:** `app/api/csp-report` (public; 30/min per IP in memory, ≤ 16 KB, CSP2 + Reporting API bodies, extension
  noise dropped) logs `[csp] {surface} {directive} blocked {origin|inline|eval} on {path}` and counts into
  `csp_violations` (day × surface × directive × blocked, path without query; > 300 rows/day fold into `other`;
  services `csp-reports.ts`). Console Overview → Server health row "Content-Security-Policy" (`health-csp`, 7 days, top 3).
- E2E `security-headers.spec`: headers per surface + API/MCP/.well-known, nonce on every `<script>`, fresh per response,
  HSTS behind https, injected un-nonced script/handler never runs, no violations across the main screens (Apply,
  contact, dashboard, editor, spa site + booking with Turnstile, widget, console), reports → console row, console
  Turnstile keys win over env. `widget.spec` frames the embed from another origin; `templates.spec` runs designs.

## Online booking (`components/booking`)

- **Steps**: service → when (up to 14 days ahead, 60-min lead time) → details (name, UAE phone, honeypot `website`) →
  done (.ics + WhatsApp confirm).
- **`bookOnline`**:
  1. In-memory per-IP limits: 20 attempts/h, 5 bookings/h (off with `AUTH_RATE_LIMIT=off`, the e2e server); honeypot;
     Turnstile `passesBotCheck` (F9).
  2. `findOrCreateClient`; blocklisted clients are refused.
  3. `createBooking` with status `pending`, source `online`, `attribution` (F13) = core `bookingAttribution` of the
     `entry` the flow sends (t.js `sessionStorage.spa_entry`, else the page's own tags + external referrer; widget
     iframe → `widget`). Shown as "Online · Instagram" (`bookingSourceLabel`), counted in `kpis.byAttribution`
     (dashboard Booking sources card) and `tenantPerformance.onlineSources` (console Performance detail).
     F16: `entry.utm.partner` (t.js + booking page keep `?partner=`) → `partnerByCode` (active partners only) →
     `bookings.partner_id`; booking detail shows "Website · QR code · {partner}".
  4. `enqueueBookingMessage`.
  5. `after(notify)`: `booking.online` bell row (dedupe `booking.online:<id>`) + push to `calendar.manage` holders.
  5. Push to the spa via `after(notifyTenant)`.
- **Embeddable widget (B5.5)**: `public/widget.js` (no deps, excluded from Biome like `t.js`) injects a button + iframe
  modal; data attributes `data-spa`, `data-url` (spa site + `/book/embed`), `data-lang` en|ar, `data-color`, `data-text`.
  Iframe route `site/[slug]/book/embed` + `domain/[hostname]/book/embed` = `BookingPage embed` (chrome-less
  `BookingFlow`, noindex). postMessage to the parent: `spa-widget:resize` {height}, `spa-widget:booked` {ref,start,service}
  (re-dispatched as a window `CustomEvent`), `spa-widget:close` (Escape); widget.js takes them only from the frame's
  own window (`e.source`), origin pinned by that frame's first message (an old path-routed `data-url` 301s to the
  spa's host-routed address; `widget.spec` host-mode step). `next.config.ts` headers: only `/book/embed` and
  `/s/:slug/book/embed` get `frame-ancestors *` and no X-Frame-Options; everything else stays SAMEORIGIN. Same
  `bookOnline` (limits + honeypot) with `via: 'widget'` (audit data only; booking source stays `online`). Analytics
  source `widget` comes from `?src=widget` (t.js: a tagged URL now starts a new session entry). Snippet:
  Settings → Booking widget (`settings/widget`, i18n namespace `widget`). e2e `widget.spec.ts`.

## Service invariants (`packages/services`)

- **Plans + entitlements (PLAN §18.8)**: rules only in `@spa/core` `plans.ts` (`PLAN_CODES`, `FEATURES` ai /
  marketing / multiBranch, `effectiveFeatures` = `tenants.feature_tier` override else `plans.limits` switches with
  missing = on, `branchCap`, `PLAN_FEATURES` pricing rows, `AUTOMATION_FEATURE`, `STUDIO_AI_AGENTS`, discounts
  `parseDiscount`/`applyDiscount`, `vatTotals` = services `invoiceTotals`, `planPriceLine`). Lookup: services
  `entitlements.ts` (`tenantEntitlements`, `assertFeature`, `featureError` → `errors.domain.featureNotInPlan`,
  `entitledSql` for platform-role cross-tenant SQL — plans are invisible to the app role, so it fails closed there;
  `planByCode`, `isLegacyPlan`). Super-admin controls: `subscription-plans.ts` (`switchPlan` — legacy only from 30
  days before renewal, new period on the old end date, no setup fee; `setSubscriptionDiscounts`; `setFeatureTier`;
  `reissueUnpaidInvoices` voids + re-issues unpaid, not-yet-due invoices, setup keeps due date + VAT choice; all
  return from/to for the audit; R19 `removePlan` deletes an unused plan or archives a used one — spas = distinct tenants
  via `tenants.plan_id` or `subscriptions.plan_id`, plus `spa_applications` rows (any status; the sheet's copy tells
  pending from past ones), counted under a lock on every plan row; the built-in `PLAN_CODES` plans (`isBuiltInPlan`)
  are always archived, never deleted, because every deploy re-runs the seed (`insert … on conflict do nothing` by
  code) and would add a deleted one back; `acceptApplication`, `switchPlan` and the new-subscription save read their
  plan FOR SHARE, so they wait for a removal in flight and then see the plan archived or gone; refused for the last
  plan new spas can get (`offeredToNewSpas`: active, not archived, not legacy) —
  `restorePlan` clears `archived_at` but leaves it inactive; DB check `plans_archived_inactive` keeps archived plans
  inactive, so the `active = true` lists (pricing `activePlans`, sign-up, `offeredPlans`, approval choices) never show
  them while spa pages read the plan by id and keep its name; the application page marks a chosen plan that is not
  among its choices "(no longer offered)" and its Accept sheet then preselects none). Discounts apply in `generateBillingScheduleTx` / `acceptApplication` via
  `discounted()` (invoice `list_aed`/`discount_aed`/`discount_label` + description note; setup discounted to 0 = no
  invoice). Where enforced: web `server/access.ts` `guard(slug, perm, feature)` + `server/entitlements.ts`
  (`getEntitlements` per request, `featureRef`), `components/plan/upsell.tsx` (`PlanUpsell`, `FeatureGate` used by
  the `layout.tsx` of inbox, campaigns, ai/content, ai/reviews, ai/try; ai/page + settings/branches check inline),
  tenant layout nav (`gated()`), SettingsTabs `showBranches`, automations page (Premium pill), F15 vouchers + F16
posters (`vouchers/layout.tsx`, `posters/layout.tsx` FeatureGate; Packages gift-card list shows a Premium pill),
integrations note,
  billing page, receipt scan, insights card; AI gateway `assertAiAllowed` (`AiNotInPlanError`); worker via
  `automationOnSql` (includes `entitledSql`) and `tenantsWithDueReplies` (`ai` flag → rows dropped).

- **Spreadsheets (R10)**: every export is .xlsx via `@spa/services/xlsx` (server-only subpath, exceljs, external in
  next.config; the main entry stays client-safe). `toXlsx` = streaming writer, title + subtitle rows, bold frozen
  header + autofilter, kinds inferred (`*AED` money, ISO dates/`YYYY-MM-DD HH:MM` → date cells, Date → Dubai wall
  time, code/phone/SKU headers stay text); text > 32,767 chars is cut and kept whole on a `long_values` sheet.
  Routes: data export (headers TH via `sheets.columns` when the viewer is th), full export = one workbook (README +
  sheet per table, raw column names), import template (EN), import errors (upload reply base64 + past-import
  route), accounts journal (EN audit file). WPS SIF keeps its bank format. Import takes CSV **or** .xlsx (first
  visible sheet; `headerRowIndex` skips one-cell title rows, so our own files re-import; TH export headers are
  autoMap aliases `TH_EXPORT_ALIASES`). Legacy .xls is refused. CSV writer (`toCsv`) removed.
- **Search / audit (X5)**: `globalSearch` takes a caller-built `scope` (missing group = not queried; phones only with
  `scope.clients.phone`); trigram GIN indexes from migration 0024. `listAuditLog`/`auditFilterOptions` read
  `audit_log` via the tenant tx; names via platformDb for those ids only.
- **Errors**: `DomainError(message, code)` with codes `slot_taken | not_found | invalid | no_room | no_staff`;
  `pgCode(e)` unwraps drizzle-wrapped errors.
- **Bookings**:
  - Each item inserts one `reservations` row per therapist plus one for the room, covering service time plus
    buffers, inside a savepoint.
  - `23P01` becomes `DomainError('slot_taken')`.
  - Ref code: insert-and-retry on `bookings_tenant_ref` `23505` (up to 5 codes), then `DomainError('invalid')`.
  - Reschedule deletes and re-inserts the reservations; cancel and no-show delete them.
  - Equipment (B5.3, `schema/workforce.ts` `equipment`; services `equipment.ts`): `services.equipment_types` lists
    required types (one unit per entry; types typed by the spa); `findSlots` needs one free unit per type
    (`pickEquipment`, `Slot.equipmentIds`); `createBooking`/`rescheduleItem` reserve them (`resource_kind =
    'equipment'`, `booking_items.equipment_ids`) in the same savepoint → EXCLUDE makes concurrent bookings of the
    last unit fail with `slot_taken`; none free → `DomainError('no_equipment')`. Delete refused while a unit holds a
    future reservation (deactivate instead). `equipmentStatus` = calendar conflict (required type not covered by an
    active reserved unit). UI: Services & rooms → Equipment card + "Equipment needed" chips in the service sheet.
  - Leave (B5.4): `loadDay` adds approved leave as `StaffAvailability.leave` (business-day windows by the branch
    cutoff); `findSlots` and the walk-in picker skip people on leave; explicit `staffIds` on leave → `DomainError
    ('no_staff')` (create + reschedule; also with `allowOffShift`). Existing bookings keep their reservations:
    `decideLeave` returns the clash count for the toast.
  - Marks (R2): staff see Pending / Completed / Cancelled (`bookingMark`, `MARK_STATUSES` in core; no-show stays
    internal). `setBookingStatus` locks the row; pending/confirmed → completed allowed; completed → pending /
    cancelled reverses the booking commission, refused while a `paid` sale exists for the booking.
  - Commission (R2): `completeBooking` = complete + `recordBookingCommissions` (AED per item + therapist, every
    pair required, 0 allowed). `booking_commissions` is append-only (trigger): edits insert the delta, leaving
    `completed` inserts the negative; each change posts 6010/2300 (`booking_commission[_reversal]`) on the
    branch's current business date; row `business_date` = the booking's. POS checkout completes without
    commission → list filter "Commission missing". Calendar can't complete/re-open (booking page only);
    entering/re-opening needs `calendar.commission` (owner, manager, receptionist).
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
    | 6150 / 6160 / 6170 | Cleaning supplies / Spa materials & supplies / Small equipment (purchases) |
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
  - **Memberships (G15, migration 0030)**: line kind `membership` (prepaid like packages: 2110, no VAT at sale) →
    `loyalty.issueMembership` = one `client_memberships` row per one-month period (`membershipPeriodEnd`; name,
    `discount_pct`, balances, `price_paid_aed`/`remaining_value_aed`, `sale_id`/`sale_line_id` snapshotted); a live
    period of the same plan makes it a renewal (starts the day after, old `due` → `active`, queued reminder skipped).
    Service lines take `membership: {id, use: 'session'|'discount'}`: session = price 0, qty 1,
    `redeemMembershipSession` (→ `membership_redemptions`, `postRedemption`, commission via `sessionCommission`,
    shared with package sessions); discount = `round(gross × pct)` added to the typed line discount (client mirrors
    it in checkout.tsx `memberOff`). Live = status `active|due` and period covers the business date.
    `runMembershipRenewals` (job `memberships-renew`): ended → `expired` + `membership_expiry` (2110 → 4000 + VAT);
    ≤ `RENEWAL_NOTICE_DAYS` (7) to the end and no later period → `due` + `membership_renewal` outbox row. Refund:
    unused value, period `refunded` (balances cleared); void blocked like packages. Statuses `paused/cancelled/lapsed`
    are unused legacy enum values.
  - The sale row is locked (`FOR UPDATE`) during a refund; it becomes `refunded` when nothing refundable is left.
    The sale total still caps all refunds (pre-F2 amount-only refunds have no lines).
  - `closeDay` runs once per branch and day.
  - Full tax invoice (G16): `sales.billing` / `clients.billing` jsonb (`BillingDetails`); `taxInvoiceLines` splits
    VAT-inclusive line totals into taxable + VAT (prepaid kinds 0 %), matching `sales.vat_aed`; invoice no. = sale
    number. Route `dashboard/[tenant]/sales/[id]/invoice`, action `saveBillingAction` (pos.use + branch scope).
- **Branches (G22)**: services/branches.ts — `createBranch` (copies main hours, plan cap), `updateBranch`,
  `setBranchActive` (archive = `active=false`, never the default), `setMemberBranches` ('all' | ids, active only),
  `memberBranchIds`, `branchesForMember`. UI: settings/branches, team edit/invite `BranchScope`. Member scope is read
  in `requireMember` (access.ts) and filtered by `allowedBranches` (calendar/data.ts, also used by the overview).
  Public booking: `bookingBranches` / `bookingBranch(tx, id?)` in components/booking/data.ts.
- **Stock locations + purchases (R8/R9, migration 0017)**:
  - A location is a branch or the spa's central warehouse = `branch_id IS NULL` on `stock_levels` /
    `stock_movements` (unique `stock_levels_location` NULLS NOT DISTINCT on tenant+branch+product; PK dropped).
    `stock_levels.low_stock_at` overrides the product threshold per location (`lowStock(tx, branchId|null)`).
  - `inventory.stockIn`/`stockOut` = movement only (no ledger); `receiveStock` = stockIn + its own entry.
    `transferStock` writes `transfer_out`/`transfer_in` with one shared `ref_id`, no ledger, locks the source level
    (`FOR UPDATE`) and never goes below zero. `countStock` = adjustStock by the difference.
  - `purchases` + `purchase_lines` + `suppliers` (`supplierByName` dedupes case-insensitively). `recordPurchase` posts
    one `purchase` entry: Dr 1200 (product lines, via stockIn with `ref_id` = purchase) / Dr `PURCHASE_ACCOUNT[category]`
    (non-stock lines) / Dr 1300 / Cr `EXPENSE_CREDIT[paidVia]` (cash 1000, card+bank 1020). `voidPurchase` takes the
    stock back out (blocked if it was used/moved), `reverseSource('purchase')`, row kept with `status = 'void'`.
  - Permission `inventory.purchase` (accountant has it); warehouse = `inventory.manage`. Receipt scan shared via
    `server/receipt-scan.ts` (expenses + purchases routes) and `accounts/expenses/receipt-scan.tsx`.
  - Purchases are not in Expenses list / data export yet (the ledger, P&L and VAT include them).
- **Payroll / pay types (R2)**: `staff.pay_type` = `booking_commission` (therapists: only their unpaid
  `booking_commissions`), `salary` (base_salary_aed), `sales_commission` (commission_pct of the net POS lines
  credited to them via `accrueCommissions`; package-session accrual too). Every line = base (salary only) +
  unpaid booking commissions + unpaid `commission_entries` (older accruals still paid) + tips − advances;
  `finalisePayroll` links both commission tables. A correction after a finalised run is a new unpaid row → next run.
  Owner decisions (migration 0021): `booking_fee` = `tenants.settings.receptionistBookingFee` × bookings whose
  `created_by` is the person's member user and that are `completed` with business date in the period
  (`completedBookingsCreated`; `payroll_lines.fee_aed`, expensed Dr 6010 at finalise). Therapist lines carry no
  tips/advances (their advances are not linked/recovered by payroll); `therapistTipsAdvances` = the separate
  "Tips & advances payout" card (tips − advances in the month, a report, no posting). "% of sales" is only shown
  in the staff form for people already on it. Re-opening a completed booking never restocks consumables
  (`consumeForBooking` is once per booking). `inventory.adjust` (receive + count; accountant, receptionist,
  manager) opens /inventory without product/usage editing (`inventory.manage`). Migration 0021 also moves
  monthly-priced subscriptions to the yearly price on the 12-month plan (`convertMonthlySubscriptions`, idempotent).
- **Waitlist (B5.1, migration 0025, X6)**: `waitlist_entries` (branch, client, optional service/variant, business
  date, optional `from_at`/`until_at` window — CHECK from < until, notes, status waiting · notified · booked ·
  cancelled, booking_id, created_by). services `waitlist.ts`: `addToWaitlist`, `cancelWaitlistEntry`,
  `listWaitlist`, `notifyWaitlistForFreedSlot` (called by `setBookingStatus` → cancelled/no_show and by
  `rescheduleItem` when the time moves; opt out with `notifyWaitlist: false`): same branch + business date,
  service matches or is open, window overlaps the freed time, client has a mobile, slot not in the past; claims ≤ 5
  oldest via `FOR UPDATE SKIP LOCKED` + status → `notified` (no double message under concurrent cancels), then queues
  outbox kind `waitlist_slot` (EN/AR default template, click-to-send). `bookFromWaitlist` locks the entry and uses
  `createBooking` (reservations EXCLUDE decides) → `booked`. Web: `dashboard/[tenant]/waitlist` (calendar.view;
  edits calendar.manage).
- **Merge duplicate clients (B5.2, X6)**: services `client-merge.ts`. `duplicateClientPairs` = same phone key (last 9
  digits) or same normalised name (two equi-join unions). `mergePreview` counts; `mergeClients` locks both rows in id
  order, re-points every FK in `CLIENT_REFERENCES` (bookings, sales, outbox, intake_submissions, treatment_notes,
  client_packages, client_memberships, gift_cards.purchaser_client_id, conversations, waitlist_entries — the test
  compares this list with `pg_constraint`, so a new FK to clients must be added there), combines fields (earliest
  created_at / first visit, latest last visit, summed no-shows, union of tags, notes joined, kept values win, gaps
  filled, opt-out/blocklist kept), deletes the merged row (hard delete). Ledger untouched. Permission `clients.merge`
  (owner + manager); audit `client.merged` with keptId + mergedId.
  Unpaid leave (B5.4): `buildPayroll` sets `deductions_aed` = salary base ÷ days in the period × approved unpaid
  leave days in it (salary pay type only; capped at base; Cr 6900 at finalise as before), `unpaid_leave_days` and
  `worked_minutes` (closed clock entries by business date; info only). WPS EDR: fixed = base − deduction, leave
  days filled.
- **Time clock (B5.4, services `timeclock.ts`)**: `staff.pin_hash` = scrypt `v1.<salt>.<hash>`; `punch` locks the
  staff row, counts wrong PINs (returned, not thrown, so they commit; 5 → locked 5 min), toggles the open entry
  (a second punch < 1 min after clock-in is refused, so double taps / two kiosks never clock straight out);
  `business_date` = branch business date of the clock-in. `adjustTimeEntry` = manager fix (`source = 'manual'`).
  `timesheet` = planned (shifts split per business day) vs worked per person/date + approved leave. Leave:
  `requestLeave` (≤ 90 days), `decideLeave` (pending only), `cancelLeave` (own pending; approvers also approved
  before it starts). Permissions `timeclock.kiosk` (receptionist), `timeclock.leave` (receptionist, therapist: own
  staff record only), `timeclock.approve` (owner/manager). Route `/timeclock` (tabs Kiosk · Timesheet · Leave),
  menu Team & roles; calendar marks staff "On leave".
- **Outbox**:
  - EN/AR `DEFAULT_TEMPLATES` or the tenant's own; inserted with `onConflictDoNothing`.
  - Staff open the WhatsApp link, then `markOutbox`.
  - Booking messages (G4): `planBookingMessages(tx, bookingId, {now, rescheduled})` in outbox.ts is the single
    planner, called by `createBooking` (when created confirmed), `setBookingStatus` (every transition) and
    `rescheduleItem` (when the start moved). Confirmed → `booking_confirmation` (now) + `reminder` (start − 24 h)
    + `reminder_2h` (start − 2 h); a reminder whose time has passed is skipped. Unsent rows are re-rendered/re-timed;
    on reschedule sent/skipped rows are re-queued. Checked-in/completed → unsent planned kinds skipped; cancelled /
    no-show → every unsent row of the booking skipped. Pending (online / AI / IG) → nothing until staff confirm;
    returning clients auto-confirmed by `selfBookingStatus` (G21) are created confirmed, so they are planned at once.
    Gated by the `bookingMessages` automation + client mobile. Queues hide rows of cancelled/no-show bookings
    (`outboxBookingLive()`: messages page, dashboard count, `navCounts`).
  - `queueCampaign` takes a row lock plus a per-tenant advisory lock.
  - Marketing rows = campaign rows + automatic `birthday` / `winback` / `review_request` drafts (F15):
    `campaignConsentWithdrawn` re-checks consent for all of them at send time (messages page, counts, hourly
    withdrawal); `planAudience`'s 7-day cap also counts birthday / win-back drafts.
  - Assignment (F28, services `outbox-assign.ts`): `outbox.assigned_to` (members.id, set null on delete) /
    `assigned_at` / `assigned_by` (user; null with an assignee = the auto rule). `assignableMembers` = active
    members whose role resolves `marketing.send` (+ branch scope); `assignOutbox` changes unsent rows only and skips
    rows of a branch the assignee can't see; web `assignMessagesAction` audits `outbox.assigned` / `outbox.unassigned`
    per row (from → to). Messages page: `?who=all|mine|unassigned` (`outboxAssigneeWhere`, counts
    `outboxAssigneeCounts`), per-card select, select-all + bulk bar. Auto rule = automation `outboxAutoAssign`
    (the only default-off switch: core `DEFAULT_OFF_AUTOMATIONS`, `automationOn` / `automationOnSql` honour it):
    worker `outbox-auto-assign` every minute → `autoAssignDueOutbox` (advisory lock per spa; due + unassigned rows,
    round-robin by member id after the last auto pick, among receptionist-role members whose linked staff has a shift
    covering now in the message's branch; nobody on shift → stays unassigned).
- **Gift vouchers + booking partners (F15/F16, services `vouchers.ts`, migration 0044_vouchers_partners)**: `gift_cards.check_token`
  (random 32-hex, default `gen_random_uuid()` without dashes, globally unique) is the QR key, never the code;
  `voucher_service_id` = treatment voucher (shows the service; value stays the AED balance). `voucherCheck(tx, token)`
  returns only status / value / balance / expiry / treatment / code's last 4 (public page
  `components/voucher/voucher-check.tsx`, routes `site/[slug]/voucher/[token]` + `domain/[hostname]/voucher/[token]`,
  `withinIpLimit('voucher-check')`, noindex + no-referrer; `/api/collect` rewrites `/voucher/{token}` → `/voucher`).
  `giftCardForPayment` / `giftCardCode` accept a scanned check URL (core `giftCardInput`); `createSale` stores the
  card's code as the payment reference. `updateVoucher` edits display fields only (recipient phone only for
  `clients.phone` roles). Dashboard print views (`vouchers/[id]`, `posters`) = inline print CSS (container units,
  `@page` A6/A5/A4) + server-side SVG from `qrcode` 1.5.4 (pinned). Partners: `booking_partners` (name, unique
  `(tenant, code)`, active); `createPartner` retries a code clash in a savepoint; `partnerBookingStats` = per partner
  (cancelled excluded) + reception (attribution `qr`, no partner). i18n namespace `growth` (+ `nav.posters`).
- **Intake PDFs (F27)**: services `intake.ts` (main entry: `intakeContentHash` = SHA-256 of the canonical record —
  ids, template version, sorted answers, waiver, signature, signed_at, ip — stored as `content_sha256` at signing;
  `intakeAnswerRows`, export list, filenames) + `pdf/intake-pdf.ts` (subpath `@spa/services/intake-pdf`):
  `renderIntakePdf` (pdfkit 0.17.2 pinned, A4, no headless browser; spa logo via sharp → JPEG, answers, consent,
  signature path, footer = submission id + record hash + page n/N) and `generateIntakePdf(tx, id)` (stores a private
  `stored_files` row, purpose `intake_pdf`; sets `pdf_file_id`, `pdf_sha256`, `pdf_generated_at`; deletes the old
  file on regenerate; fills `content_sha256` for pre-F27 rows). Web: `submitIntakeAction` renders right after the
  insert commits (failure → page offers "Create PDF"); `regenerateIntakePdfAction` (clients.manage); submission page
  Download / Regenerate + Integrity card (stored vs recomputed hash); profile list PDF icon; Settings → Data
  `export?type=intake_pdfs` = streamed STORE zip (`zip.ts`, needs clients.export + clients.view).
  Text (`pdf/text.ts`): fonts are base64 OFL subsets in `pdf/fonts.generated.ts` (DM Sans / Noto Sans Thai / Noto
  Naskh Arabic, 400 + 700; rebuilt by `packages/services/scripts/pdf-fonts.py` from the installed @fontsource
  packages; licence `pdf/FONTS-OFL.txt`; biome-ignored), per-character font fallback, reduced UBA (W4/W5/W7, N0
  brackets, N1/N2, L2 reorder), Intl.Segmenter word breaks (Thai). pdfkit gotchas: pass `features` (else it lays
  out word by word and reverses RTL word order); Noto Naskh shares skeleton/dot glyphs between letters, so Arabic
  pieces carry `/ActualText` spans (copy text in Acrobat/PDFium; pdf.js shows near-letters) and glyphs without text
  map to U+034F; `font: null` (no Helvetica AFM read).
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
| `db-backup` (pg_dump → off-site bucket: `R2_*`, else the `S3_*` bucket under `backups/` (`offsiteConfig`; a half-set `R2_*` = not configured); every ok/skipped/failed run in `platform_job_runs`; console overview warns when the last ok run is missing or > 36 h old) | 03:30 |
| `worker-heartbeat` (G8: `platform_job_runs` row with disk %, `deploy.json`, `configFlags` presence map; 1 day kept; touches `/tmp/worker-heartbeat`; incidents disk > 85 % / backup > 36 h / deploy failed → `ops-alert` rows open=failed/closed=ok, one email per incident to `PLATFORM_ADMIN_EMAILS`; also sent once at worker start) | every 5 min |
| `restore-drill` (latest R2 daily dump → scratch DB as `spa_drill` (F11: `DATABASE_URL_DRILL`, else built from `DATABASE_URL_OWNER`'s host + `SPA_DRILL_PASSWORD`/derived; refuses SUPERUSER/CREATEROLE/BYPASSRLS/REPLICATION via core `drillRoleProblem`; superuser-only extensions e.g. pg_stat_statements left out of the restore list; drops only its own scratch DB; passwords via PGPASSWORD, masked in errors; old `RESTORE_DRILL_ADMIN_URL` ignored with a warning) → counts + migrations → drop; result in platform-only table `platform_job_runs` (tenant `job_runs` is B3's spa log), shown on the super-admin overview; skipped run recorded when R2 is unset; manual twin `scripts/restore-drill.sh [dump]`) | 2nd of month 05:00 |
| `instagram-reply` (DB queue `instagram_reply_queue`, RLS, PK = message id: the Meta webhook's `ingestInstagramWebhook` inserts the row in the message's transaction for live spas; the job finds spas with due rows (`tenantsWithDueReplies`, platform role), `claimDueReplies` (5-min lease, SKIP LOCKED), `inboundAnswered` skips threads already answered, `finishReply` deletes, `failReply` backs off 30 s ×2 … 30 min, `failed_at` after 5 tries. Web has no pg-boss / owner URL / `after()`) | every minute |
| `analytics-rollup` | hourly at :07 |
| `analytics-prune` | 04:20 |
| `packages-expire` | 04:10 |
| `memberships-renew` (switch `membershipRenewals`; due + WhatsApp renewal reminder, expiry) | 04:25 |
| `media-prune-ai` | 04:40 |
| `slot-filler` | 10:30, 15:30 |
| `verify-custom-domains` | every 10 min |
| `instagram-publish` (also resumes videos parked while Instagram processes them, F18) | every 5 min |
| `instagram-token-refresh` (+ Facebook Page token check `checkFacebookPageTokens`, F19) | 03:40 |
| `gbp-reviews-sync` | every 2 h at :15 |
| `gbp-site-sync` (F17: `syncGbpBookActions` re-points Book buttons whose address changed, 6 h retry; `submitDueSitemaps` sends sitemaps queued by a publish ≥ 2 min ago; Premium live spas) | every 10 min |
| `campaigns-housekeeping` | hourly at :15 |
| `outbox-auto-assign` (F28; spas with the default-off switch on; logged only when it assigned something) | every minute |
| `client-drafts` (F15 review / birthday / win-back drafts; default-off switches, Premium) | hourly at :25 |
| `document-reminders` | 09:00 |
| `weekly-insights` | Mon 08:00 |
| `daily-digest` | 09:30 |
| `billing-transitions` (F22: services `runBillingTransitions` — overdue → grace → read-only per console Billing rules, `billing.autoTransitions` flag off = paused (lift only); one tx per spa, audited `platform.billing.stage`, `billing.late`/`read_only`/`restored` notices + owner/super-admin email when configured) | 09:05 |

Integration jobs do nothing until their credentials are configured.

**Automation switches (B3).** `tenants.settings.automations` = `{ [AutomationKey]: boolean }`, missing = on
(`AUTOMATIONS` / `automationOn` in `packages/core/src/automations.ts`; `automationOnSql` / `setAutomation` (atomic
jsonb merge) / `getAutomations` / `isAutomationOn` in `services/src/automations.ts`). Gates: `bookingMessages`
(confirmation + reminder), `thankYou` (thank_you) and `reviewRequests` (review_request) inside `enqueueBookingMessage`
(returns null when off); `slotFiller` (plus the AI agent's own enabled flag), `packageExpiry`, `membershipRenewals`, `instagram` (in
`publishDueInstagramPosts`), `googleReviews`, `weeklyInsights`, `dailyDigest`, `documentAlerts` in the worker's
tenant queries (`apps/worker/src/jobs/runs.ts` `activeTenants(key)`). F15 `reviewRequests` / `birthdayMessages` /
`winbackMessages` (default off, Premium `marketing`): hourly `client-drafts` → services `client-drafts.ts`
(`queueReviewRequests` / `queueBirthdayMessages` / `queueWinbackMessages`; advisory lock per spa + kind; consent via
growth `marketingConsent`; due time through `afterQuietHours`; caps `CLIENT_DRAFT_LIMITS`; branch = the client's last
booking, else the default branch; `{link}` = review link / `spaSiteUrl(slug)/book`); logged as `review-requests` /
`birthday-messages` / `winback-messages` only when something was queued. Timing card on `/automations`
(`saveClientDraftsAction`, settings.manage + marketing). Backups + domain checks are locked on. Not
switchable (housekeeping): analytics, media prune, campaigns housekeeping, Instagram token refresh. **Run log:**
tenant-scoped `job_runs` (job, status ok·skipped·failed, `summary` counts; RLS) written by `recordRun()` (never
throws; prunes > 7 days); Instagram logs only when it published/failed. UI: `/automations` (`settings.manage`),
i18n namespace `automations`.

## Deploy, CI, e2e

- **Droplet stack** (`deploy/droplet/compose.yml`):
  - postgres 16 (1200m);
  - `migrate` (worker image: migrate + seed);
  - web (1200m; build arg `NEXT_PUBLIC_ROUTING=${ROUTING:-path}`, also set at run time for web + worker: services
    `freeSiteUrl` reads it from `process.env`, which Next doesn't inline);
  - worker (512m; healthcheck = age of `/tmp/worker-heartbeat`; `/opt/spa/status` mounted ro as `OPS_STATUS_DIR`);
  - `updater-sync` (one-shot alpine: copies `update.sh` to `/usr/local/bin/spa-update` on every `up`);
  - every service: json-file log rotation 5 × 10 MB (`x-logging`);
  - caddy: `{$SITE_HOST}` block (certificate at start) + `https://` catch-all with on-demand TLS that asks
    `/api/domains/allowed` (www/app/admin/{slug} of every platform root, the extra roots, custom domains), a 25 MB
    body cap, `/_status` behind basic auth (snippet `status_page`: on `SITE_HOST`, and on `*.sslip.io` in the
    catch-all so the droplet's own address keeps it after the move). `ACME_EMAIL` is never empty (an empty value
    stops Caddy).
    Client IP (F26): `trusted_proxies static` = Cloudflare ranges (+ `trusted_proxies_strict`), `client_ip_headers
    Cf-Connecting-Ip` only; `proxy_to_web` sets `Cf-Connecting-Ip {client_ip}` (Cloudflare's header from a Cloudflare
    peer, else the TCP peer) and strips Do-Connecting-Ip / X-Real-Ip / True-Client-Ip. `test-caddy-ip.sh` (caddy or
    docker) runs the real file against a header echo; `cloudflare-ips.sh [--write]` checks/refreshes the ranges.
  - There is no cloudflared in the running stack.
- **`update.sh`**:
  - The systemd timer runs it every 2 minutes. G7: it deploys the CI-green ref `deploy/green` (moved by CI job
    `promote`, forward only; tip fallback only until the ref first exists, marker `/opt/spa/ci-gated`), never the raw
    tip. Steps: build → `pg_dump -Fc` `/opt/spa/backups/pre-migrate-<sha12>.dump` (keep 5) → `up` (migrate with
    `lock_timeout`/`statement_timeout`, `migrationUrl` in packages/db/src/migrate.ts) → `/api/health`; any failure →
    redeploy `/opt/spa/last-good`, `deploy.json` state `failed`, commit in `status/failed` (not retried without
    `--force`). Also writes `status/gate.json` and merges log-opts into `/etc/docker/daemon.json`. `caddy_sync`
    (F26) restarts caddy when the bind-mounted Caddyfile it runs differs from the checkout (the hard reset swaps the
    file's inode, so a running container never saw Caddyfile edits); Caddy not up again = deploy failure → rollback.
    Paths overridable (`SPA_ROOT`, `SPA_LOCK`, `DOCKER_DAEMON_JSON`) for shell tests only.
  - `build_env` (each `deploy_commit`, so a rollback brings the last good commit's own settings): `.env` =
    `.env.base` (first-boot env; copied from `.env` once) < `secrets.env.enc` (AES-256-CBC, pbkdf2 200k, key
    `/opt/spa/secrets.key`; unknown contents, only the droplet can decrypt) < `deploy/droplet/site.env` (plain,
    public; allow-list `SITE_KEYS` = SITE_HOST ROUTING APP_URL ADMIN_URL EXTRA_ROOT_DOMAINS ACME_EMAIL VAPID_SUBJECT
    CF_CNAME_TARGET EMAIL_FROM; other lines skipped + logged to build.log, never fatal), later layer wins per key,
    written atomically, mode 600. No overlay + no site.env = `.env` untouched; overlay that won't decrypt = untouched
    + status error (as before). Main body guarded (`BASH_SOURCE`) so `test-update.sh` can source the functions.
  - A changed `update.sh` takes effect from the deploy after the one that ships it (`updater-sync` installs it during
    `up`), so a change that relies on it (e.g. a site.env value) must land in a later push, once a commit with the
    new updater and without that value shows `"state":"ok"` (it is the rollback target; README "Move to
    spamanagement.co" step 3). `.env` is generated: hand edits go to `.env.base` (SSH) or the overlay.
- **Deploy branch**: `claude/intelligent-heisenberg-g9e81o` (confirmed by the owner 2026-10-08). It is set as
  `BRANCH` in the droplet secrets and is also the GitHub default branch; a push reaches production once its CI run
  is green (job `promote` → `deploy/green`), ~2 min after that.
- **CI** (`.github/workflows/ci.yml`) runs on PRs and on pushes to `main` and the deploy branch: job `check`
  (bootstrap `spa_test` → lint → typecheck → test → web build → Playwright e2e) and, in parallel, job `guards` (F25):
  `pnpm db:check-drift` (packages/db/scripts/check-drift.sh: drizzle-kit generate into a scratch copy of drizzle/ via
  `DRIZZLE_OUT`; passes only on "No schema changes" + unchanged copy), the migration-journal tests, `pnpm audit
  --prod --audit-level=high` (accepted advisories: pnpm-workspace.yaml `auditConfig.ignoreGhsas`, reason + review
  date each), `deploy/droplet/test-caddy-ip.sh` and `deploy/droplet/test-update.sh` (build_env fixtures + the
  committed site.env: allowed keys, no duplicates or empty values, SITE_HOST/ROUTING/APP_URL/ADMIN_URL together and matching).
  `promote` needs both. Also: `codeql.yml` (codeql-action v3,
  javascript-typescript, security-extended; deploy-branch pushes, PRs, Mondays; baseline 2026-10-10: only
  `js/insufficient-password-hash` in restore-drill.ts, for the owner to dismiss ("won't fix", §17); trailing-run trims use core `trimTrailing`, not
  `/x+$/`), `cloudflare-ips.yml` (Mondays + PRs
  touching the Caddyfile; not a deploy gate), `.github/dependabot.yml` (npm + actions weekly, minor/patch grouped;
  stack pins' majors, and 0.x/minor pins' minors, ignored).
- **e2e**:
  - Playwright starts its own dev server on :3100 (via `scripts/next.mjs`) against `spa_test`.
  - Settings: workers 1, test timeout 90 s, `PLATFORM_ADMIN_EMAILS=admin@e2e.test` + the admin-join.spec addresses
    (`join-confirm@`, `join-link@`, `listed-apply@e2e.test`; deliberately with a duplicate and an empty segment).
  - Host routing by default; set `E2E_ROUTING=path` for path routing (needs a build with `NEXT_PUBLIC_ROUTING=path`).
    The super-admin helper and slug-rename.spec work in both since R20 (verify link on the bare host; one-host 2FA
    landing → console). Same-host redirects come back with a relative Location (Next `getRelativeURL`), so specs
    compare `new URL(location, from).href`; CI runs host mode.
  - `global-setup` resets the DB and seeds the platform.
  - Helpers sign up owners through the UI; `makeStudio` grants platform admin; `createLogin` (login only, browser
    sign-up) + `addMember(slug, email, role)` for staff; `consoleEmailKey(page, key|null)` routes staff mail to the
    outbox (`outboxMails()`; remove the key again afterwards).
  - Auth coverage (F14): `two-factor.spec` (enrol, sign-in step, 5-attempt cap, backup codes once, off, manager
    policy, super-admin without 2FA), `password-reset.spec` (outbox link, single use, expiry, sign-out elsewhere,
    unknown email, closed login), `files-access.spec`; per-IP limits are off on the e2e server (`AUTH_RATE_LIMIT=off`)
    and live in `packages/auth/test/rate-limit.test.ts`.

## Ask AI (F30, dashboard assistant)

- **UI** `components/assistant/ask-ai.tsx` (top-bar button → Radix side drawer, crm.css `.crm-ask*`; full screen
  ≤680 px), rendered by the tenant layout for members with `dashboard.view` (SpaShell `assistant` prop) — never for a
  super-admin acting on the spa (no spa data; the Studio editor lives in the console since R23); accessible name "Ask AI about your spa" (`assistant.openLabel`, the Studio's
  page AI is "Ask AI to edit this page"). Standard (no `ai`): the
  drawer is the Premium upsell (`plan.upsell.*`). Conversation state is client-only; i18n namespace `assistant`.
- **Action** `components/assistant/actions.ts` `askAssistantAction`: guard(dashboard.view, 'ai') → members only
  (`ctx.member`; impersonation → `errors.forbidden`) → zod →
  `withinRateLimits` (`assistant`, tenant:user, 30/h + 150/day) → `runAssistant` (fixtureClient in e2e) → audit
  `ai.assistant.asked` {question ≤200, locale, outcome, tools, denied, costUsd} (never the answer). Maps gateway
  errors (budget / paused / plan / disabled / busy) to `assistant.errors.*`; translates link labels; prefixes
  dashboard paths with `appPath('/{slug}')` and only passes `https://wa.me/` drafts.
- **Agent** `packages/ai/src/agents/assistant.ts`: `runAssistant` → `runToolLoop` (agent key `staff_assistant`, seeded
  in `defaultAiModels`; limits `ASSISTANT_LIMITS`). Tools (each: required permissions checked first, zod args, own
  `withTenant`, branch scope re-read via `memberBranchIds`; super-admin view = all branches): `list_branches`,
  `bookings_summary` (calendar.view; therapists-style roles = own bookings via `staffIdForMember`; client names need
  clients.view, amounts dashboard.revenue), `revenue_summary` (reports.view + dashboard.revenue; `kpis` summed per
  allowed branch), `top_services` (reports.view; revenue only with dashboard.revenue), `lapsed_clients` (clients.view;
  limited members: clients who booked at their branches), `staff_on_shift` (staff.view), `whatsapp_draft`
  (marketing.send + clients.phone; campaign consent rules; returns no phone to the model). Refusals come back as
  `{error:'not_allowed'}` and are listed in `denied`. Links (`AssistantLink`) are pushed by tools, deduped, max 8.
- **Services** `packages/services/src/assistant.ts`: `bookingStatusCounts`, `staffNames`, `lapsedClients`,
  `shiftsOnDate`, `assistantDraftTarget`, `staffIdForMember` (no permission checks inside, as everywhere).
- **Tests**: `packages/ai/test/assistant.test.ts` (scripted ModelArk fetch), e2e `ask-ai.spec.ts` (`__steps` fixture).

## Meta MCP (R7, AI tools)

- **Server** `packages/ai/src/mcp/meta-server.ts`: stateless Streamable HTTP (`@modelcontextprotocol/sdk` 1.31.0, JSON
  responses), one McpServer per request. Auth = `signMcpToken` (`mcp/token.ts`: HMAC of `META_MCP_SECRET` or
  `BETTER_AUTH_SECRET`, domain-separated; claims tenant, agent, acting user; ≤ 5 min). Live tenants only.
  Served at `/api/mcp/meta`; agents call it **in-process** through the same handler (`metaMcpSources`, real MCP client
  + token) unless `META_MCP_URL` is set.
- **Tools** (`mcp/tools.ts` registry, domain code in `@spa/services` `meta-mcp.ts` on the existing Graph client +
  stored tokens): `instagram.list_comments|reply_comment|list_dms|draft_dm_reply|create_post_draft|publish_approved_post`,
  `facebook_page.list_comments|reply_comment|create_post_draft|publish_approved_post` (only with a connected
  `social_accounts` platform `facebook` row = Page id + Page token, connected via F19 Facebook Login), `whatsapp.read_inbox_summary`,
  `whatsapp.draft_message` (outbox row `custom`/`queued` for tap-send). **No WhatsApp send tool**; `isForbiddenTool`
  drops any WhatsApp send-like tool from every server (name rules + description/schema mentioning WhatsApp).
- **Exposure** = agent allow-list (`AGENT_META_TOOLS`: dm_agent, comment_agent, content_agent, slot_filler, meta_agent)
  ∩ spa toggles (`tenants.settings.metaMcp.groups`: instagram_inbox, instagram_posts, facebook_page, whatsapp on by
  default; external off) ∩ connections (publish needs Meta configured + IG connected). `instagram.reply_comment` sends
  only when `metaMcp.autopilot` (else an `ai_draft` in the inbox); `facebook_page.reply_comment` only exists on autopilot.
  Publish tools only publish `scheduled` (approved) posts whose time has come. Model function names map `.` → `__`.
- **Audit**: every write tool inserts `audit_log` `ai.mcp.<tool>` (tenant, acting user, agent, clipped args, outcome);
  the run itself `ai.mcp.run`; settings `ai.mcp.settings.updated`; console `platform.meta_mcp.updated`.
- **External server** (super-admin AI page): `platform_settings.meta_mcp_enabled|url|key_enc (AES-GCM)|tools` — only
  listed names, prefixed `ext__`, only for agents allowing `external` (meta_agent) and spas with the group on.
- **UI**: Settings → Integrations card `components/integrations/meta-mcp-card.tsx` (account, tool states, group +
  autopilot toggles, "Ask the AI" → `askMetaAiAction` → `runMetaAgent`). E2E `meta-mcp.spec.ts` scripts the model with
  `{"__steps": [...]}` fixtures (`server/ai-fixture.ts`). Migration 0028_meta_mcp (also `social_platform` += `facebook`).

## AI assistant MCP connector (Claude + ChatGPT, site editing, `/api/mcp`)

- **OAuth** (packages/auth): Better Auth `jwt()` + `@better-auth/mcp` `mcp()` (oauth-provider 1.7.7; tables in
  `@spa/db` `schema/oauth.ts`: jwks, oauth_client/resource/client_resource/refresh_token/access_token/consent/
  client_assertion). Resource = `mcpResourceUrl()` (canonical APP_URL + `/api/mcp`; dev `*.localhost` → `localhost`).
  Open DCR (rate-limited), PKCE, login `/login`, consent `/oauth/consent` (`(auth)/oauth/consent`, EN+TH keys
  `auth.oauth.*`). Auth `hooks.before` on `/oauth2/authorize` (ineligible → consent page `?not_enabled=1`) and
  `/oauth2/consent` (403). `oauthProviderClient()` in the browser client sends the signed query, so sign-in / 2FA
  resume the flow (`forms.tsx` follows the returned `url`). Discovery: `app/.well-known/[...path]` → auth handler
  (proxy no longer rewrites `/.well-known/*`). `verifyMcpAccessToken`: local JWKS (cached 5 min), audience-bound.
  ChatGPT (R25) needs nothing extra from Better Auth: issuer = resource metadata's, `iss` on every authorize redirect
  (so its stable callback), S256, public DCR (`none`); no CIMD (`@better-auth/cimd` needs an app-owned fetch).
- **Server** `packages/ai/src/mcp/site-server.ts` `handleSiteMcpRequest` (stateless, JSON): bearer → verify →
  `siteAiEditorStatus` → consent row for (user, client) → 60/min per token (in memory) → tools (`SITE_MCP_TOOLS`) over
  the ops layer; no publish tool; every call audited `site.mcp.<tool>` with `via: 'via AI assistant (MCP)'` + client
  name. Annotations: `SITE_MCP_TOOL_HINTS` next to the table (one entry per tool, test-checked; read tools
  readOnlyHint; destructiveHint = deletes or overwrites draft content: remove_block, replace_html_design,
  update_block, set_theme, rename_page (only add_block / add_page / move_block false); openWorldHint false; no entry =
  destructive write).
  Writes to a page open in someone else's Studio editor are refused with the holder's name (F29 lock); `get_site`
  lists `editing` per page.
  Route `app/api/mcp/route.ts` passes the Puck schema, `normalizeTheme`, preview secret, canonical app URL, and (R24)
  `templates` (`templateCatalog` + kind classic/design/studio/html via `DESIGN_TEMPLATE_KEYS` + console preview URL),
  `fileUrl` (`designFileUrl`, canonical `/files/{id}/{name}`) and `imageFetch.allow` (`SITE_IMPORT_E2E_ALLOW`, e2e only).
- **R24 design tools** (all audited, drafts only): `list_templates`; `apply_template` = services `switchTemplate`
  with `replaceContent`, `draftTheme` (template theme → `sites.themeDraft`, live `theme` untouched; `TemplateUndo`
  `draftTheme`/`themeDraft`, so the console Undo restores the previous draft theme and is refused once it changed or was
  published), `lockUserId` (F29 locks → `PageLockedError`) and `prepare` = `materializeTemplatePageData` (HTML template
  files copied into the spa); dry run = `planTemplateSwitch` (pages new/kept, locked, HTML pages). The console switch is
  unchanged (live theme). HTML pages: `set_html_design` (op `html_design`, `convert` for a page with blocks),
  `replace_html_design` (same op, no convert), `patch_html_design` (op `html_patch`), `get_html_design`
  (`getHtmlDesign`; slices ≤ 200 000 chars, `search` → positions + context); designs are stored byte for byte as the
  spa's private `html_design_doc` file (results: `html_chars`, `html_bytes`, `stored: 'exactly as sent'`, `embeds` +
  `warning` for third-party frames), `phone_fixes` default false (patch keeps the flag unless given); `get_site` pages
  carry `html: {chars, phone_fixes}`. Request bodies up to `SITE_MCP_MAX_REQUEST_BYTES` (2 × 5 MiB + 256 KiB: a whole
  design JSON-escaped; the SDK default 4 MiB answered 413) — the proxy buffers up to 11 MB (next.config
  `experimental.proxyClientMaxBodySize`). `add_image`: services `fetchMediaImage`
  (F32 `safeFetch`: public addresses only, redirects re-checked, 10 s, ≤ 8 MB; https only except allow-listed test
  hosts; declared Content-Type AND magic bytes ∈ IMAGE_TYPES, never SVG) → `createAsset` (public, purpose media, tags
  `ai-assistant` + host, filename `ai-{host}`); 10/min per token (also refused attempts) + 100/day per spa (`imageLimits`); returns `path`
  (`/files/{id}`, for block props) + absolute `url` + an `<img>` tag. R25 merged in: the six tools are in
  `SITE_MCP_TOOL_HINTS` (list_templates / get_html_design read-only; apply_template, set/patch_html_design
  destructive — they overwrite drafts; add_image additive) and every R24 text is assistant-neutral ("from the AI
  assistant", version label "Before AI assistant HTML design …").
- **Links** (R23): server option `adminUrl` (route passes `canonicalUrls().admin`): `list_spas` + `get_site` return
  `console_url`; `list_spas` reports `website` (none / template / draft / live, from `websiteOverview`) +
  `unpublished_changes`; texts say the owner previews and publishes in the console (Websites → spa).
- **Console** → Websites: `ConnectClaudeCard` ("Connect Claude or ChatGPT": URL + copy, both setups, own connected
  clients (no client_name → redirect host), Revoke = `revokeClaudeClientAction`: deletes consent + tokens, keeps the
  client, audited `platform.mcp.client_revoked`). Tests: `packages/ai/test/site-mcp.test.ts`,
  `packages/services/test/site-edit.test.ts` + `sites.test.ts` (draft-theme switch), `packages/auth/test/mcp.test.ts` (callbacks + OAuth metadata with real
  requests), e2e `site-mcp.spec.ts` (Claude: real DCR → authorize → 2FA → consent → token → tools → revoke; ChatGPT:
  both callbacks, all scopes, `iss`, refresh, annotations, lookalikes refused; `SITE_AI_EDITOR_EMAILS` in
  playwright.config.ts lists owners of slugs `ai-editor`, `mcp-editor`, `gpt-editor`, `texts-editor`).
- **Hardening** (packages/auth): `hooks.before` on `/oauth2/register|create-client|update-client` →
  `isAllowedMcpRedirectUri` (mcp.ts; Claude callbacks + ChatGPT's stable one + `chatgpt.com/connector/oauth/{id}`
  raw-string pattern; `MCP_REDIRECT_URIS` = exact list replacing all); `validateRedirectUri` same rule on
  authorize; client admin API in `disabledPaths`; `clientPrivileges` = `siteAiEditorStatus` ok; `hooks.after` on
  `/oauth2/consent` audits grants (`entity` oauth_client, `entityId` client id). Prune: services `oauth-clients.ts`
  `pruneUnusedOAuthClients` (worker `oauth-clients-prune`, hourly): > 24 h old, no consent and no grant audit row
  (ChatGPT/Claude reuse their client_id after Revoke; a pruned one answers invalid_client → re-add the connector). Real client IP: see "Client IP" below (Better Auth `ipAddressHeaders` =
  `[CLIENT_IP_HEADER]`, `ipv6Subnet: 64`).
- **Draft concurrency + publish** (services sites.ts): `lockSite` (FOR UPDATE on `sites`, re-entrant) at the start of
  saveDraft / publishPage / publishAll / addPage / renamePage / restoreVersion / runSiteEdit (non-dry) /
  restoreSiteEdit and the Theme panel action. `editStamp` / `assertEditStamp` / `EDITED_ELSEWHERE`: the editor page
  passes the stamp; editor.tsx `takeStamp` refreshes it from every save / publish / restore / Ask AI reply.
  `promoteDraftTheme` + `applyPendingRename` (re-checks the slug) run in publishPage and publishAll. Preflight:
  `server/site-preflight.ts` `themeDraftWarnings` (editor `publishNotesAction`, overview Publish site sheet).

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
