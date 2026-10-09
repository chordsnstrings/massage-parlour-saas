# Code map

Where things live and how a request flows. Verified against the code on 2026-10-08 (re-checked at commit `6992d74`).
`docs/PLAN.md` stays the source of truth for product decisions; update this file when the structure changes.

## Workspace (pnpm + Turborepo)

| Package | Role |
|---|---|
| `@spa/core` (packages/core) | Pure helpers, no DB. `booking.ts`: Dubai time, `businessDateOf`/`businessDayWindow` (cutoff default `'05:00'`), `openIntervals`, `findSlots`, `pickStaff`, `newRefCode`, `includedVat`, `BOOKING_TRANSITIONS`. `permissions.ts`: `resource.action` catalogue + `SYSTEM_ROLES` (owner, manager, receptionist, therapist, accountant, content_editor); system roles resolve from code, custom roles from the DB list; `clients.phone` only ever for `PHONE_ROLES` (owner, manager, receptionist — stripped from every other role, custom roles can't get it: `roleMayHold`, `CUSTOM_ROLE_PERMISSIONS`); `TWO_FACTOR_POLICY_ROLES` (owner, manager). `hosts.ts`: `parseRoots`, `matchRoot`, `resolveSurface`. `slug.ts`: `RESERVED_SLUGS`, `checkSlug`. `whatsapp.ts`: `toUaeE164`, `whatsappLink` (desktop/web/mobile). `email.ts`: `sendStaffEmail` (Resend; settings from `resolveEmailConfig`: console source registered via `setEmailSettingsSource` (globalThis registry; web instrumentation + worker start), then env; `setEmailTransport` = e2e outbox only). `config-health.ts`: `configChecks`/`configFlags` (presence only, console overview). `report.ts`: Sentry-compatible `reportError`, no SDK. `i18n/` (subpath `@spa/core/i18n`, spa dashboard EN + TH): `en.ts` source catalogue (`en-ui.ts` = UI-kit strings), `th.ts` typed `Messages` (missing key = type error), `translate.ts` (`createTranslator`: dotted keys, `{param}`, `{one,other}` plurals, `t.has`/`t.maybe` for runtime keys), `format.ts` (`createFormat(locale)`: Dubai dates, Thai = `th-TH-u-ca-gregory-nu-latn`, AED stays `AED 1,234`); client code imports the narrow subpaths. |
| `@spa/db` (packages/db) | Drizzle schema (`src/schema/`: auth, platform, tenant, operations, commerce, finance, inventory, growth, site, files), `client.ts` (`platformDb`, `appDb`, `withTenant`), migrations `drizzle/0000–0021` (hand-written SQL inside), `sql/bootstrap.sql` (roles + extensions btree_gist, citext). Subpaths `/migrate`, `/seed`, `/testing`. |
| `@spa/auth` (packages/auth) | Better Auth on `platformDb`: email + password (min 10), TOTP plugin, dynamic `baseURL` (allowed hosts = platform domains, fallback `APP_URL`), rate limits in production only. `user.locale` ('en' | 'th') is an `additionalFields` entry (validated), written via `updateUser`. `./client` for the browser. |
| `@spa/services` (packages/services) | All domain logic that touches the DB. Functions take the caller's `tx: Tx`; services do **not** check permissions or write `audit_log` (callers do). `./site-kit` is client-safe (preflight, contrast, scoped CSS ≤ 4 KB, schedule, Puck tree helpers). |
| `@spa/ai` (packages/ai) | `modelark.ts` (OpenAI-compatible client, no SDK) and `gateway.ts` `runChat`/`runImage`: config from `ai_model_config` by `agentKey` → monthly budget check against `tenants.ai_budget_usd` (Dubai month) → call → zod validation (`json_schema` when `supportsStructuredOutput`, else instructions + 1 retry) → meter `ai_usage`. Agents: `dm` (receptionist chat that books via tools), `instagram` (comment replies, `respondToInstagram`), `content` (IG post, review reply, SEO), `insights` (weekly), `receipt` (OCR: `vision` key, else `dm_agent`), `slots` (slot filler → outbox), `context` (`loadSpaContext`, `SAFETY`), `meta` (R7 Meta tools assistant). `tool-loop.ts` `runToolLoop` = the shared OpenAI-style tool loop (local tools + MCP sources, every step through `runChat`, so budget + `ai_usage` per step; the DM agent uses it). `mcp/`: Meta MCP (see "Meta MCP" below). |
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
  `plans`, `ai_model_config`, `push_subscriptions`, `site_templates`, `tenant_purges` (G12 purge record; its column is
  `purged_tenant_id` because a `tenant_id` column marks an RLS tenant table — db rls test + `tenantTables()`).
  `tenants` adds a `tenant_self` policy so a spa sees its own row.
- **Data deletion (G12, PLAN §18.2)**: services `data-deletion.ts` — `purgeTenant` (soft-deleted spa only; DELETE
  tenants cascades every `tenant_id` FK — all are ON DELETE CASCADE, keep it that way for new tables), bucket prefix
  delete `deleteTenantObjects` (storage.ts), `autoPurgeDeletedTenants` (worker `tenant-auto-purge`, off unless
  `platform_settings.auto_purge_days`), `eraseClient` (anonymise, keep financial rows; a new client FK in
  `CLIENT_REFERENCES` must also be decided here: keep or delete on erase).
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
   - `/api`, `/files`, `_next` and static assets are not rewritten.
2. **`server/session.ts`**: `getSession` reads `headers()` first; `requireUser` redirects to `{surface}/login?next=`.
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
     shared, stored or sent. Platform domains = `ROOT_DOMAIN` (canonical, spamanagement.co) + `EXTRA_ROOT_DOMAINS`
     (old spamanagement.ae); droplet compose lets `APP_URL`/`ADMIN_URL` be overridden for `ROUTING=host`.
   - `lib/paths.ts`: `appPath`/`adminPath` for path mode.

## Web routes (`apps/web/src/app`)

- **`dashboard/(auth)`**: login, signup, invite/[token], 2FA, forgot/reset password.
  - Signup calls `provisionTenant`, which creates the tenant, a default branch, the 6 system roles, the owner member
    and a trial subscription on the first active plan. An email listed in `PLATFORM_ADMIN_EMAILS` becomes a
    platform admin only once **verified** (G2: `grantListedPlatformAdmins` in `@spa/db` — used by provision, seed and
    `requirePlatformAdmin`; never demotes). Sign-up sends a verification email (`emailVerification.sendOnSignUp`,
    sign-in not gated; Google sign-ins arrive verified). `sendStaffEmail` throws in production without `RESEND_API_KEY`.
- **`dashboard/[tenant]`** (PLAN §14.6): `layout.tsx` renders `.crm` (`lang` = viewer locale) → `I18nProvider` →
  `components/shell/spa-shell.tsx` (sidebar: logo/initials + name + branch line, profile menu, grouped menu, plan card
  with AI meter = month `ai_usage` ÷ `tenants.ai_budget_usd`; top bar: group crumb + title (home = greeting), EN | ไทย;
  ≤860 px drawer). Look = `crm.css` (tokens on `:root:has(.crm)`, lifted under `[data-crm-off]` = site editor/preview
  overlays; UI kit reads `--ui-*` density hooks whose fallbacks are its old sizes). Menu (permission-filtered; items
  with several pages show section tabs under the top bar):
  - Workspace: Dashboard, Calendar, Sales, Inbox & follow-ups (messages · inbox · campaigns).
  - People: Clients, Services & menu (services · packages · inventory · purchases · warehouse), Team & roles (staff · timeclock · team · documents).
  - Growth: Marketing (ai/content · analytics · AI studio = ai, ai/try), Website studio (website · media), Reviews
    (ai/reviews).
  - Finance: Accounts (P&L, VAT, expenses with receipt scan, journal, export), VAT & payroll (payroll + WPS SIF),
    Billing (Stripe Checkout for platform invoices only).
  - System: Settings (incl. logo, hours, intake, integrations, domains, data).
  - Not in the menu (X6): `waitlist` (linked from the Calendar + Bookings headers) and `clients/duplicates`
    (Clients header "Duplicates", needs `clients.merge`; `?keep=&merge=` = preview + merge).
  - Hidden until Phase 3: Bookings list, Automations, Coming next. Account + switch spa = profile menu.
  - Nav count badges: `ShellItem.count` ← `server/nav-counts.ts` (`navBadgeCounts`, React cache) ← services
    `calendar.ts` `navCounts` (one query): Calendar today, Bookings pending today, Inbox = due outbox + unread IG.
  - Calendar ranges: `calendar/page.tsx` `?range=week|month` → `loadCalendarSpan` (data.ts) → services
    `loadCalendarRange` → `components/calendar/span-view.tsx`; Day view takes `?open=<bookingId>` (PLAN §14.6 Phase 3).
  - Top bar global search (`components/search`: `searchAction` + `SearchPalette`, ⌘K/Ctrl+K; PLAN §14.9).
  - Settings → Security: require-2FA toggle (`saveSecurityAction`), recent audit rows;
    `settings/audit` = audit log viewer (`audit.view`).
- **`dashboard/account`** (profile, 2FA, push) (`?require2fa=<slug>` notice from the 2FA policy) and **`dashboard/dev/kit`** (design-system gallery).
- **`platform/(console)`**: overview, tenants, plans, settings, audit, ai models, domains (order approval), templates
  (studio templates), websites (studio overview), performance (PLAN §18.1: `performance/data.ts` loops tenants via
  `platformDb()` and reads each spa in its own `withTenant()` — one query per spa from `services/src/performance.ts`
  `tenantPerformance`; detail adds `tenantPerformanceDetail`). Revenue there = sales (paid|refunded) by sale business
  date − `refunds` by refund business date; web numbers from `web_events` (90-day retention → range cap 92 days).
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
  - `mcp/meta`: first-party Meta MCP server (R7, `handleMetaMcpRequest`; bearer = 5-minute signed tenant token).

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
- **HTML designs (R17)**: `/platform/templates` "Upload HTML" (`uploadHtmlTemplateAction`) saves a studio template
  whose home page is one hidden `HtmlDesign` block (`components/site/blocks/html-design.tsx`, category `design`,
  `visible: false` ⇒ out of the AI schema) with the raw file in `props.html`; root prop `htmlDesign: true` makes the root
  render skip `SiteFrame`. Render = `<iframe srcdoc sandbox="allow-scripts allow-forms allow-popups…">` (no
  `allow-same-origin`: design scripts can't touch platform cookies/APIs); `{{placeholders}}` filled + HTML-escaped from
  `SiteMeta`; injected click handler keeps `#anchors` in-frame, sends other links to `_top` (external → new tab), inert
  when `meta.editing`. Size cap = page JSON ≤ 500 KB. E2E: `templates.spec.ts` "HTML design upload".
  - Transforms are pure in `@spa/core` `html-design.ts` (tests `packages/core/test/html-design.test.ts`):
    `htmlDesignDocument` adds a viewport meta if missing + `HTML_DESIGN_BASE_CSS` (all `:where()`, first in <head> so
    the design's rules win) + the link script; `fixHtmlDesign` (upload) adds the viewport and turns inline img
    `width:Npx` > 360 into `width:100%;max-width:Npx`; `listHtmlDesignImages` ids = `img-<n>` (n-th `<img>`) /
    `bg-<n>` (n-th `background(-image)` url in `<style>` + inline styles; scripts/comments/fonts skipped).
  - Adjustments = block prop `images: HtmlImageAdjust[]` ({id, src (first 300 chars, must still match), fit, x, y,
    align, replace}); applied by `applyHtmlImageAdjustments`: `data-spa-img` attr + `!important` rules at the end,
    background position/size appended after the declaration, replace URL must match `HTML_IMAGE_URL` (https or
    site path; srcset dropped). UI `templates/html-images.tsx` (`HtmlFileField` in the upload sheet reads the file
    client-side; `HtmlImageAdjuster` with 360/1280 sandboxed preview); saved via `uploadHtmlTemplateAction` (hidden
    `images` JSON) or `saveHtmlImagesAction` ("Images" row button, `updateStudioTemplate` now takes `pages`).
    Replacement uploads go into the chosen spa's media library (`/files/upload`, normal size cap; public files, so
    they break if that spa is deleted). E2E: "HTML design images".
- **Website Studio gating** (`dashboard/[tenant]/website/page.tsx`):
  - Edit, design and publish need `isStudio` plus the matching permission.
  - Non-studio members (`site.content` or `services.manage`) get `ServicesPrices` (`website/services-prices.tsx`,
    PLAN §18.1): services + prices with the menu-only `ServiceSheet` (`menuOnly`: operational fields posted as hidden
    inputs) and a live-site link; no preview, status or change requests. Every status move (send for review,
    withdraw, approve, reopen) is `setStudioStatusAction` behind `studioGuard(…, 'site.publish')` (R1); every
    studio-actions.ts action is `studioGuard`ed. `createChangeRequest` (services) has no caller in the app now.
  - The editor route 404s for non-studio users.
- **Saving and publishing**:
  - Draft JSON is capped at 512 KB.
  - Design changes need `site.design` (checked via `designSignature`).
  - Preflight runs before publish (`server/site-preflight.ts`); errors block publishing, warnings don't.
- **Ask AI (R16, studio editor only)**: header ✨ panel (`components/site/editor/ai-edit.tsx`) → `editor/ai-edit-actions.ts`.
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
  - Events land in `web_events`, are rolled up hourly and pruned after 90 days.

## Online booking (`components/booking`)

- **Steps**: service → when (up to 14 days ahead, 60-min lead time) → details (name, UAE phone, honeypot `website`) →
  done (.ics + WhatsApp confirm).
- **`bookOnline`**:
  1. In-memory per-IP limits: 20 attempts/h, 5 bookings/h.
  2. `findOrCreateClient`; blocklisted clients are refused.
  3. `createBooking` with status `pending`, source `online`.
  4. `enqueueBookingMessage`.
  5. `after(notify)`: `booking.online` bell row (dedupe `booking.online:<id>`) + push to `calendar.manage` holders.
  5. Push to the spa via `after(notifyTenant)`.
- **Embeddable widget (B5.5)**: `public/widget.js` (no deps, excluded from Biome like `t.js`) injects a button + iframe
  modal; data attributes `data-spa`, `data-url` (spa site + `/book/embed`), `data-lang` en|ar, `data-color`, `data-text`.
  Iframe route `site/[slug]/book/embed` + `domain/[hostname]/book/embed` = `BookingPage embed` (chrome-less
  `BookingFlow`, noindex). postMessage to the parent: `spa-widget:resize` {height}, `spa-widget:booked` {ref,start,service}
  (re-dispatched as a window `CustomEvent`), `spa-widget:close` (Escape). `next.config.ts` headers: only `/book/embed` and
  `/s/:slug/book/embed` get `frame-ancestors *` and no X-Frame-Options; everything else stays SAMEORIGIN. Same
  `bookOnline` (limits + honeypot) with `via: 'widget'` (audit data only; booking source stays `online`). Analytics
  source `widget` comes from `?src=widget` (t.js: a tagged URL now starts a new session entry). Snippet:
  Settings → Booking widget (`settings/widget`, i18n namespace `widget`). e2e `widget.spec.ts`.

## Service invariants (`packages/services`)

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
  - The sale row is locked (`FOR UPDATE`) during a refund; it becomes `refunded` when nothing refundable is left.
    The sale total still caps all refunds (pre-F2 amount-only refunds have no lines).
  - `closeDay` runs once per branch and day.
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
    no-show → every unsent row of the booking skipped. Pending (online / AI / IG) → nothing until staff confirm.
    Gated by the `bookingMessages` automation + client mobile. Queues hide rows of cancelled/no-show bookings
    (`outboxBookingLive()`: messages page, dashboard count, `navCounts`).
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
| `db-backup` (pg_dump → off-site bucket: `R2_*`, else the `S3_*` bucket under `backups/` (`offsiteConfig`; a half-set `R2_*` = not configured); every ok/skipped/failed run in `platform_job_runs`; console overview warns when the last ok run is missing or > 36 h old) | 03:30 |
| `worker-heartbeat` (G8: `platform_job_runs` row with disk %, `deploy.json`, `configFlags` presence map; 1 day kept; touches `/tmp/worker-heartbeat`; incidents disk > 85 % / backup > 36 h / deploy failed → `ops-alert` rows open=failed/closed=ok, one email per incident to `PLATFORM_ADMIN_EMAILS`; also sent once at worker start) | every 5 min |
| `restore-drill` (latest R2 daily dump → scratch DB via `RESTORE_DRILL_ADMIN_URL` (CREATEDB; compose uses the postgres superuser) → counts + migrations → drop; result in platform-only table `platform_job_runs` (tenant `job_runs` is B3's spa log), shown on the super-admin overview; skipped run recorded when R2 is unset; manual twin `scripts/restore-drill.sh [dump]`) | 2nd of month 05:00 |
| `instagram-reply` (DB queue `instagram_reply_queue`, RLS, PK = message id: the Meta webhook's `ingestInstagramWebhook` inserts the row in the message's transaction for live spas; the job finds spas with due rows (`tenantsWithDueReplies`, platform role), `claimDueReplies` (5-min lease, SKIP LOCKED), `inboundAnswered` skips threads already answered, `finishReply` deletes, `failReply` backs off 30 s ×2 … 30 min, `failed_at` after 5 tries. Web has no pg-boss / owner URL / `after()`) | every minute |
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

**Automation switches (B3).** `tenants.settings.automations` = `{ [AutomationKey]: boolean }`, missing = on
(`AUTOMATIONS` / `automationOn` in `packages/core/src/automations.ts`; `automationOnSql` / `setAutomation` (atomic
jsonb merge) / `getAutomations` / `isAutomationOn` in `services/src/automations.ts`). Gates: `bookingMessages`
(confirmation + reminder) and `thankYou` (thank_you + review_request) inside `enqueueBookingMessage` (returns null
when off); `slotFiller` (plus the AI agent's own enabled flag), `packageExpiry`, `instagram` (in
`publishDueInstagramPosts`), `googleReviews`, `weeklyInsights`, `dailyDigest`, `documentAlerts` in the worker's
tenant queries (`apps/worker/src/jobs/runs.ts` `activeTenants(key)`). Backups + domain checks are locked on. Not
switchable (housekeeping): analytics, media prune, campaigns housekeeping, Instagram token refresh. **Run log:**
tenant-scoped `job_runs` (job, status ok·skipped·failed, `summary` counts; RLS) written by `recordRun()` (never
throws; prunes > 7 days); Instagram logs only when it published/failed. UI: `/automations` (`settings.manage`),
i18n namespace `automations`.

## Deploy, CI, e2e

- **Droplet stack** (`deploy/droplet/compose.yml`):
  - postgres 16 (1200m);
  - `migrate` (worker image: migrate + seed);
  - web (1200m; build arg `NEXT_PUBLIC_ROUTING=${ROUTING:-path}`);
  - worker (512m; healthcheck = age of `/tmp/worker-heartbeat`; `/opt/spa/status` mounted ro as `OPS_STATUS_DIR`);
  - `updater-sync` (one-shot alpine: copies `update.sh` to `/usr/local/bin/spa-update` on every `up`);
  - every service: json-file log rotation 5 × 10 MB (`x-logging`);
  - caddy: on-demand TLS that asks `/api/domains/allowed`, a 25 MB body cap, and `/_status` behind basic auth.
  - There is no cloudflared in the running stack.
- **`update.sh`**:
  - The systemd timer runs it every 2 minutes. G7: it deploys the CI-green ref `deploy/green` (moved by CI job
    `promote`, forward only; tip fallback only until the ref first exists, marker `/opt/spa/ci-gated`), never the raw
    tip. Steps: build → `pg_dump -Fc` `/opt/spa/backups/pre-migrate-<sha12>.dump` (keep 5) → `up` (migrate with
    `lock_timeout`/`statement_timeout`, `migrationUrl` in packages/db/src/migrate.ts) → `/api/health`; any failure →
    redeploy `/opt/spa/last-good`, `deploy.json` state `failed`, commit in `status/failed` (not retried without
    `--force`). Also writes `status/gate.json` and merges log-opts into `/etc/docker/daemon.json`.
    Paths overridable (`SPA_ROOT`, `SPA_LOCK`, `DOCKER_DAEMON_JSON`) for shell tests only.
  - It applies the `secrets.env.enc` overlay (AES-256-CBC, pbkdf2 200k).
- **Deploy branch**: `claude/intelligent-heisenberg-g9e81o` (confirmed by the owner 2026-10-08). It is set as
  `BRANCH` in the droplet secrets and is also the GitHub default branch; a push reaches production once its CI run
  is green (job `promote` → `deploy/green`), ~2 min after that.
- **CI** (`.github/workflows/ci.yml`) runs on PRs and on pushes to `main` and the deploy branch: bootstrap `spa_test` → lint → typecheck →
  test → web build → Playwright e2e.
- **e2e**:
  - Playwright starts its own dev server on :3100 (via `scripts/next.mjs`) against `spa_test`.
  - Settings: workers 1, test timeout 90 s, `PLATFORM_ADMIN_EMAILS=admin@e2e.test`.
  - Host routing by default; set `E2E_ROUTING=path` for path routing.
  - `global-setup` resets the DB and seeds the platform.
  - Helpers sign up owners through the UI; `makeStudio` grants platform admin.

## Meta MCP (R7, AI tools)

- **Server** `packages/ai/src/mcp/meta-server.ts`: stateless Streamable HTTP (`@modelcontextprotocol/sdk` 1.30.1, JSON
  responses), one McpServer per request. Auth = `signMcpToken` (`mcp/token.ts`: HMAC of `META_MCP_SECRET` or
  `BETTER_AUTH_SECRET`, domain-separated; claims tenant, agent, acting user; ≤ 5 min). Live tenants only.
  Served at `/api/mcp/meta`; agents call it **in-process** through the same handler (`metaMcpSources`, real MCP client
  + token) unless `META_MCP_URL` is set.
- **Tools** (`mcp/tools.ts` registry, domain code in `@spa/services` `meta-mcp.ts` on the existing Graph client +
  stored tokens): `instagram.list_comments|reply_comment|list_dms|draft_dm_reply|create_post_draft|publish_approved_post`,
  `facebook_page.list_comments|reply_comment|create_post_draft|publish_approved_post` (only with a connected
  `social_accounts` platform `facebook` row = Page id + Page token; **no Page connect flow yet**), `whatsapp.read_inbox_summary`,
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
