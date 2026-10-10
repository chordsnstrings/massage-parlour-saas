# spamanagement.co — Product & Technical Plan

B2B SaaS for massage parlours in the UAE: booking, rooms & therapists, clients, POS (cash), basic accounting,
site builder with block-level analytics, and AI agents (Instagram, Google Business Profile, SEO).

Status: **planning — no app code until approved.** Last updated 2026-10-06.
External facts (Meta, Google, DigitalOcean, Cloudflare, ModelArk, library versions) were checked against
official docs on 2026-10-06; re-check anything marked *(verify)* when its phase starts.

---

## 0. Locked decisions

| Topic | Decision |
|---|---|
| Market | UAE only. Currency AED, timezone Asia/Dubai (UTC+4, no DST; store UTC). |
| Customer | B2B — massage parlours / spas. One pilot spa. |
| Team | Owner + Claude. |
| Domain | `spamanagement.co` (tenant sites at `{slug}.spamanagement.co`, optional custom domain). |
| Customer payments | Recorded only (cash, card on the parlour's own terminal, bank transfer). Platform processes nothing. Stripe later. |
| SaaS price | **Premium** setup AED 14,000 + AED 3,000/month, **Standard** setup AED 9,000 + AED 2,000/month, excl. VAT (§18.8; the old AED 24,000/year plan = legacy until each spa's renewal), paid by cash, bank transfer or card (Stripe Checkout for platform invoices), recorded by the super-admin. |
| Customer comms | **WhatsApp only**, receptionist click-to-send (no SMS, no email to customers, no unofficial automation). |
| AI provider | BytePlus ModelArk, **Seed 2.0 family by default**; model per agent chosen by super-admin (GLM selectable, not default). |
| Analytics | Block-level click/visibility analytics + funnels (no session replay in v1). |
| Site builder | Drag-and-drop modular builder, 8 templates, granular per-device control so each spa makes the site its own (§11). |
| Responsiveness | Every tenant site page and every role view is fully responsive, 360 px phones → wide desktops (§11.5, §12.4). |
| Admin design | Minimal Swedish modern: airy, well-padded grid layouts, calm palette, one accent, micro-animations (§12). |
| Infra budget | ≤ USD 50/month now; scale later. DigitalOcean. |
| Legal | Out of scope for the software; the parlour/company owns it. Client waiver/contract is captured as a signed intake form. |

---

## 1. Modules & scope

Legend: **MVP** = pilot runs daily ops on it · **P2/P3/P4** = later phase (see §13).

### 1.1 Tenancy, onboarding, domains
- Self-serve signup → pick subdomain (`{slug}.spamanagement.co`) → business info → theme → services/rooms/staff wizard → publish. **MVP**
- Reserved slugs: `www app admin api mail customers status cdn assets help docs blog`. Rename = old slug 301-redirects. **MVP**
- **AI onboarding:** paste Instagram handle / Google Maps link → AI drafts services, copy, photos, hours, colours → site ready to tweak. **P3**
- CSV import: clients, services, products (Fresha-style exports). **P2**
- Custom domain (`www.theirspa.ae`) via Cloudflare for SaaS (§3.3). **P2**
- Multi-location (branches) per tenant — schema from day 1, UI **MVP** for 1 branch, multi-branch **P2**.
- Tenant data export (zip of CSV/JSON). **P2**

### 1.2 ULM — users, roles, permissions
- Roles: Owner, Manager, Receptionist, Therapist, Accountant + **custom roles** (permission matrix: resource × action). **MVP**
- Branch scoping (user sees only assigned branches). **MVP**
- Sensitive-data gates: revenue visibility; **therapists never see client phone numbers** (anti-poaching). **MVP**
- Email + password, TOTP 2FA (mandatory for owners), invites, session list/revoke, audit log of every write. **MVP**
- Therapist PWA view: own schedule, check-in/out, own commission/tips. **MVP**

### 1.3 Services, rooms, resources
- Services: categories, EN/AR names & descriptions, duration/price variants (60/90/120 min), VAT-inclusive price,
  buffer before/after (cleanup), allowed room types, required equipment, therapists required (1, or 2 for couples/4-hands),
  online-bookable flag. **MVP**
- Rooms: type (single/couple/VIP/foot/Thai mat…), capacity, branch, active. **MVP**
- Equipment/resources with quantity (hot-stone set, steam). **P2**

### 1.4 Booking engine (the core)
- Availability = therapist on shift ∩ has skill ∩ free room of allowed type ∩ equipment ∩ buffers ∩ no overlap. **MVP**
- **Double-booking impossible at DB level**: a `reservations` table with a Postgres `EXCLUDE USING gist` constraint
  over (resource, time range) for staff, rooms and equipment. **MVP**
- Couples / 4-hands: one booking reserves 2 therapists + 1 room atomically. **MVP**
- **Business day with cutoff** (e.g. day closes 05:00) — late-night shops; shifts and reports cross midnight correctly. **MVP**
- Walk-ins + **therapist rotation ("turn") list** per branch per business day; "any therapist" assigns by rotation. **MVP**
- Client preferences as filters (preferred therapist, therapist gender, pressure) — preferences, not rules. **MVP**
- Calendar: day view by therapist columns and by room, drag to reschedule/reassign, colour by status. **MVP**
- Statuses: pending → confirmed → checked-in → in-service → completed / no-show / cancelled. **MVP**
- Online booking: customer picks service → time → (therapist) → name + UAE mobile → booking **pending** →
  confirmation screen with **"Confirm on WhatsApp"** (prefilled message with booking ref) → receptionist confirms. **MVP**
- Per-tenant setting: auto-confirm returning clients; new clients stay pending until confirmed. No-show counter, blocklist. **MVP**
- Waitlist per day/service. **P2**
- Home / hotel visits (address, travel buffer, driver). **P4, only if pilot needs it**

### 1.5 Clients (CRM)
- Profile: name, UAE phone (E.164, unique per tenant), language, birthday, nationality (optional), source, tags,
  preferences (pressure, oils, allergies, focus areas, preferred therapist/gender), notes, blocklist + reason. **MVP**
- Visit history, spend, last visit, no-shows, packages/gift-card balances. **MVP**
- **Intake form + waiver/contract e-sign** (EN/AR, signature pad on reception tablet, stored as PDF, re-sign on template change). **MVP**
- Treatment notes per visit (therapist-written). **MVP**
- Duplicate merge by phone. **P2**

### 1.6 POS & payments (recorded, not processed)
- Checkout from booking or walk-in: services, retail products, packages, gift cards, discounts/promo codes. **MVP**
- Payment methods: Cash, Card (own terminal), Bank transfer, Gift card, Package credit, Other — split payments. **MVP**
- Tips (per therapist, cash or card). **MVP**
- Refunds/voids with reason + permission. **MVP**
- **Daily close / Z-report** per branch: opening float, expected vs counted cash, variance, card/bank totals. **MVP**
- Receipts/tax invoices: printable + shareable via WhatsApp link (public signed URL). **MVP**

### 1.7 Packages, gift cards, memberships (owner-defined)
- Packages: owner builds bundles (e.g. 10 × 60-min), price, validity; balances per client; redeem at checkout. **P2**
- Gift cards: code + QR, value, expiry, balance history; printable / WhatsApp-able voucher. **P2**
- Memberships: monthly fee + benefits (included sessions, % off); renewals recorded manually (cash). **P2**
- All create **liabilities** in the ledger until redeemed (§10).

### 1.8 Staff / HR
- Profiles, gender, photo, skills (services), branches, employment details. **MVP**
- Shifts (templates + exceptions, can cross midnight), leave, time clock (PIN on reception tablet / PWA). **MVP**
- Commission rules: %, fixed per service, tiered by monthly sales, per-service overrides. **P2**
- **Salary advances & deductions** tracking. **P2**
- Monthly payroll summary: base + commission + tips − advances/deductions → export (CSV; WPS SIF file **P4**). **P2**
- **Document expiry tracker**: configurable types (passport, visa, Emirates ID, labour card, health card…) with
  30/60/90-day reminders to owner. **P2**

### 1.9 Inventory
- Products (retail + consumables), stock per branch, purchases, adjustments, stock counts. **P2**
- Consumables auto-deducted per service (e.g. 30 ml oil per 60-min massage). **P2**
- Low-stock alerts; cost of goods posted to ledger. **P2**

### 1.10 WhatsApp outbox (click-to-send) — the comms backbone
- System **generates** messages; receptionist **clicks to send**. Kinds: booking confirmation, reminder (day before / 2 h before),
  thank-you + review request, rebook nudge, package expiring, birthday, win-back, slot-filler offers, campaigns. **MVP** (confirm/remind) · rest **P2**
- Templates per kind, EN/AR, variables (`{first_name}`, `{time}`, `{therapist}`, `{link}`). **MVP**
- Send modes (per-user setting): **WhatsApp Desktop** (`whatsapp://send?phone=…&text=…`, instant),
  **WhatsApp Web** (`https://web.whatsapp.com/send?phone=…&text=…`, reuses one tab), **mobile** (`https://wa.me/971…?text=…`).
  Number format `9715XXXXXXXX` (no `+`, no leading 0). Keep URL < ~2000 chars. *(verify desktop protocol UX in P0 spike)*
- Outbox UI: queue by due time, keyboard flow (open → send in WhatsApp → mark sent → next), assign to receptionist. **MVP**
- Guardrails: no unofficial WhatsApp Web automation libraries (number bans); marketing only to clients with visits and not opted out;
  per-day pacing counter. **MVP**
- WhatsApp Cloud API (coexistence with the Business app) for automated reminders — optional paid tier. **P4**

### 1.11 Reviews & marketing
- Review request after completed visit via outbox (direct Google review link). **P2**
- Segments: lapsed N days, birthday this week, package expiring, top spenders, by service/therapist/branch. **P2**
- Click-to-send campaigns: segment + template → outbox batch; stats: sent → booked within 14 days. **P2**
- Promo codes. **P2**

### 1.12 Site builder (§11) — **MVP** (layout primitives, 15 core blocks, 3 templates, responsive overrides, EN/AR) · rest P2/P3
### 1.13 Analytics (§9) — business KPIs **MVP**, web/block analytics **P2**
### 1.14 Accounting (§10) — **P2** (daily close is MVP)
### 1.15 AI agents (§7) — **P3** (gateway + metering in P0)

### 1.16 "Book" button everywhere
- Site booking widget + standalone page `{slug}.spamanagement.co/book`. **MVP**
- Embeddable script for parlours keeping an old site. **P2**
- Instagram bio link (`?src=ig`), GBP "Book" button set via Place Actions API (`?src=gbp`). **P3**
- QR poster for reception / hotel concierge partners. **P2**

### 1.17 Platform super-admin (`admin.spamanagement.co`)
- Tenants (status, plan, usage, last activity), impersonation (audited, banner shown). **MVP**
- Plans: **Premium / Standard** (setup + monthly, §18.8; legacy AED 24,000/year until renewal), feature switches + limits (branches, staff, AI budget, custom domain). **MVP**
- Platform invoices, **manual payment recording** (cash/bank transfer, reference, proof upload), due/overdue list,
  WhatsApp reminder links to tenant owners, grace period → dashboard read-only (public site stays live). **MVP**
- AI: model per agent (Seed 2.0 defaults), price table, usage & cost per tenant, budgets, global + per-tenant kill switch. **P0/P3**
- Feature flags, announcements, audit log viewer, backup status. **MVP**

### 1.18 Notifications to staff/owners
- In-app notification centre + **web push (PWA)**: new online booking, pending confirmations, low stock, document expiry,
  AI drafts awaiting approval. Email only for owner/staff account matters (invites, password reset). **MVP**

### 1.19 Languages
- Tenant sites: EN + AR (RTL) from day 1. RU/ZH later.
- Dashboard: EN first; AR **P4**.

---

## 2. Key flows

**Online booking → confirmation**
1. Visitor on `{slug}.spamanagement.co` opens booking widget (event `booking_start`, block id recorded).
2. Picks service/duration → slots computed server-side → picks slot → enters name + mobile.
3. Server creates booking `pending` inside a transaction that inserts `reservations` (EXCLUDE constraint guarantees no clash).
4. Confirmation screen: "Confirm on WhatsApp" → opens chat with parlour, prefilled `Hi, confirming booking #K7Q2 …`.
5. Dashboard shows pending; outbox has the confirmation message ready; receptionist clicks → sends → marks confirmed.
6. Reminder appears in outbox at the configured time.

**Walk-in**
Reception → "Walk-in" → service → "next in rotation" therapist + free room suggested → start → checkout → daily close.

**Custom domain**
Tenant enters `www.theirspa.ae` → API creates Cloudflare custom hostname → UI shows `CNAME www → customers.spamanagement.co`
+ ownership TXT → background job polls → active → becomes primary; apex redirect via registrar forwarding
(many .ae registrars lack CNAME flattening). On the droplet (no Cloudflare for SaaS) Caddy issues certificates on demand,
asking `/api/domains/allowed` first; in path-routing mode any non-platform host is served as `/domain/{host}`.

**Buy a domain (Namecheap)**
The spa searches a name (candidates across .com/.co/.net/.spa/.salon/.beauty/.massage/.shop; Namecheap doesn't sell .ae) with live
registrar prices in AED (USD × 3.6725, rounded up) → requests one (`domain_orders`, max 3 open, one open order per domain across
spas) → super-admin approves in /admin/domains (shows the Namecheap balance) → platform registers it on the platform's Namecheap
account (registrant = spa owner + spa legal name; admin/tech/billing = platform company details; free WhoisGuard), connects
`www.<domain>` as the spa's custom domain and sets DNS (www CNAME → platform, apex URL-301 → www, TXT proof). The registrar price is
recorded on the order and added to the spa's next manual invoice. A failed registration marks the order `failed` (retryable);
once registered, connection problems are notes, never a failed order. API calls only work from the whitelisted droplet IP.

**Publish site**
Editor saves draft JSON → Publish creates immutable `page_version` → cache tag revalidated + Cloudflare purge for the host.

**Instagram DM → booking (P3)**
Webhook → `conversations` (store `last_customer_msg_at`) → DM agent (Seed 2.0 lite, tools: `get_services`, `check_availability`,
`create_pending_booking`, `handoff_to_human`) → reply within 24 h window (≤ 1000 bytes) → pending booking + outbox confirmation.
Inappropriate messages: brief, neutral reply, no engagement, flagged in inbox.

---

## 3. Architecture & infrastructure (≤ USD 50/month)

### 3.1 Topology
```
Visitors (tenant subdomains + custom domains)        Staff / owners (app.spamanagement.co)
                    │                                           │
         Cloudflare (Free): DNS, proxy, Universal SSL (*.spamanagement.co),
         Cloudflare for SaaS (custom hostnames), edge cache (Dubai PoP), WAF basics
                    │  Cloudflare Tunnel (no open inbound ports)
         ┌──────────┴────────── DO Droplet (Premium AMD 4 GB / 2 vCPU) ───────────┐
         │ docker compose:                                                       │
         │  cloudflared · web (Next.js 16 standalone: marketing, dashboard,      │
         │  admin, tenant sites by host) · worker (pg-boss jobs, AI agents,      │
         │  social posting, cron) · postgres 16                                  │
         └───────────────────────────────────────────────────────────────────────┘
                    │                                   │
         Cloudflare R2 (media, AI assets,        BytePlus ModelArk ap-southeast (Johor):
         nightly pg_dump; free ≤10 GB)           Seed 2.0 chat, Seedream images
```
- **One Next.js process** serves everything (route groups + host-based rewrite) to save RAM.
- **No Redis**: pg-boss (Postgres-backed queue + cron) and in-process LRU caches.
- Fallback if Tunnel + Cloudflare for SaaS origin doesn't work as expected: Caddy with Cloudflare Origin CA cert, firewall
  allowing only Cloudflare IPs. *(verify in P0 spike)*

### 3.2 Region
- DO has no Middle-East region. Published data: Dubai→Frankfurt ≈ 92 ms, Dubai→London ≈ 93 ms, Dubai→Bangalore ≈ 154 ms.
- **Default FRA1**; confirm with a 5-minute ping from the pilot spa's connection to
  `speedtest-{fra1,lon1,ams3,blr1}.digitalocean.com`. Cloudflare caches tenant sites in Dubai anyway.
- AI calls go to Johor regardless; they're async/background so the extra latency is irrelevant.

### 3.3 Domains & TLS
- `spamanagement.co` (marketing), `app.` (dashboard), `admin.` (super-admin), `{slug}.` (tenant sites),
  `customers.` (CNAME target for custom domains). Nameservers delegated to Cloudflare.
- Universal SSL covers apex + first-level wildcard → no wildcard cert work on the server.
- Custom domains: Cloudflare for SaaS — **100 hostnames free**, then USD 0.10/hostname/month. No Let's Encrypt rate-limit concerns.

### 3.4 Monthly cost

| Item | USD/mo |
|---|---|
| DO Premium AMD droplet 4 GB / 2 vCPU / 80 GB (FRA1) | 28.00 |
| DO daily backups (30%) | 8.40 |
| Cloudflare Free (DNS, proxy, SSL, Tunnel, for SaaS ≤100 hostnames) | 0 |
| Cloudflare R2 (≤10 GB free, zero egress) | 0 |
| Resend free (staff/owner email only) | 0 |
| Sentry free, uptime monitor free | 0 |
| GitHub Actions + GHCR (watch 500 MB private-package quota; prune old tags) | 0 |
| **Total** | **≈ 36.40** (+ domain renewal) |

AI usage (ModelArk) is metered per tenant and priced into plans — not part of the infra budget.

**Scaling steps (in order):** move Postgres to DO Managed PostgreSQL (USD 15, PITR) → bigger droplet or 2nd app droplet →
R2 paid tier → ClickHouse for analytics only if Postgres rollups get slow.

### 3.5 Ops
- Postgres tuned for 4 GB (shared_buffers ≈ 1 GB); container memory limits so the worker can't starve web.
- Images built in CI, never on the droplet. Deploy = pull image tag → `docker compose up -d` with healthcheck; rollback = previous tag.
- Backups: nightly `pg_dump` → R2 (30 daily, 12 monthly) + DO daily disk backups; **monthly restore drill** script.
- No always-on staging (budget): CI runs e2e against an ephemeral docker compose stack at phase milestones.
- Monitoring: Sentry (errors), uptime checks on `app.` and a sample tenant host, `pg_stat_statements`, structured JSON logs.

---

## 4. Tech stack (pinned majors)

| Layer | Choice | Notes |
|---|---|---|
| Language / repo | TypeScript, pnpm workspaces + Turborepo | |
| Web | **Next.js 16** (App Router, `output: 'standalone'`) | `middleware.ts` is now **`proxy.ts`** (Node runtime). Matcher must exclude `_next/static`, `_next/image`, assets. Re-check tenant inside Server Functions/route handlers too. |
| UI | Tailwind CSS 4, shadcn/ui | Use logical utilities (`ms-/me-/ps-/pe-/start-/end-`) for RTL. |
| Site editor | **`@puckeditor/core` ^0.23** (MIT) | Old `@measured/puck` is frozen at 0.20 — ignore tutorials using it. Nesting via `slot` field. RTL not documented → spike. |
| Animation | `motion` 14 + CSS scroll-driven animations | `@supports (animation-timeline: view())` fallback; honour `prefers-reduced-motion`. |
| DB | PostgreSQL 16 | |
| ORM | **Drizzle 0.45.x (pinned)** | 1.0 is still beta — don't mix docs. RLS via `pgPolicy`/`pgRole`, `pgTable.withRLS()`. |
| Auth | **Better Auth 1.7** | organization plugin (org = tenant), twoFactor (TOTP), email+password. No phone OTP (would need SMS/WA API). |
| Jobs | **pg-boss 12** | Node ≥ 22.12, cron schedules, no Redis. |
| Validation | zod | Also validates AI JSON output. |
| Images | sharp → AVIF/WebP, stored in R2 | |
| AI | OpenAI-compatible client → ModelArk | §7 |
| Tests | Vitest (unit/integration with real Postgres), Playwright (e2e) | |

Repo layout:
```
apps/web          Next.js: (marketing) (dashboard) (admin) (site) route groups + proxy.ts
apps/worker       pg-boss workers + cron (AI agents, publishing, polling, rollups, backups)
packages/db       Drizzle schema, migrations, RLS policies, withTenant(), seeds
packages/core     domain logic: availability, reservations, pricing/VAT, ledger posting, commissions
packages/auth     Better Auth config, permission matrix
packages/blocks   Puck config: blocks, themes, tokens, tracker attributes
packages/ai       ModelArk gateway, agents, tools, metering, prompts (EN/AR)
packages/ui       shared components
packages/config   tsconfig, eslint, prettier
```
*As built (2026-10-08):* `packages/{core,db,auth,services,ai}` + `apps/{web,worker}`; blocks and UI kit live in
`apps/web/src/components/{site,ui}`, tool config at the root (Biome). See `docs/CODEMAP.md`.

---

## 5. Multi-tenancy & security

- **Shared schema, `tenant_id` on every tenant table, Postgres Row-Level Security on all of them.**
- `withTenant(tenantId, fn)` opens a transaction and runs `select set_config('app.tenant_id', $1, true)` (transaction-local;
  session-level `SET` leaks across pooled connections).
- App connects as a role that is **not the table owner and has no BYPASSRLS**; migrations run as owner.
- CI test: app role cannot read/write another tenant's rows (every table, generated).
- Host → tenant resolution in `proxy.ts` (LRU cache, 60 s) → rewrite to `(site)` routes; unknown host → branded 404.
- Super-admin uses a separate role/connection with explicit audit logging.
- RBAC checked server-side on every action (never trust UI hiding). Branch scoping in queries.
- Rate limiting (per IP + per tenant) on booking + auth endpoints; Cloudflare Turnstile on public booking form.
- Secrets (Meta/Google tokens, ARK key) encrypted at rest (AES-GCM with key from env); Meta long-lived tokens refreshed
  by job before 60-day expiry.
- Custom HTML block (if ever added) rendered in sandboxed iframe; tenant site CSP.

---

## 6. Data model (Postgres; all tenant tables carry `tenant_id` + RLS)

**Platform (no RLS, super-admin only)**
- `tenants` (slug, name, legal_name, trn, status: trial|active|past_due|read_only|suspended, default_locale, created_at)
- `plans` (name, setup_fee_aed, monthly_aed, annual_aed, limits jsonb)
- `subscriptions` (tenant, plan, cycle, period_start/end, next_due, grace_until)
- `platform_invoices`, `platform_payments` (method cash|bank_transfer, reference, proof_file, received_by)
- `domains` (tenant, hostname, kind subdomain|custom, status pending|verifying|active|failed, cf_hostname_id, is_primary)
- `ai_model_config` (agent_key, model_id, params, price_in/out, enabled) · `ai_usage` (tenant, agent, model, tokens_in/out, images, video_tokens, cost_usd, at)
- `feature_flags`, `announcements`, `audit_log` (tenant?, actor, action, entity, diff, ip, at)

**Identity & ULM**
- Better Auth tables (`users`, `sessions`, `accounts`, `organizations`=tenants link, `members`, `invitations`, `two_factors`)
- `roles` (tenant, name, is_system) · `role_permissions` (role, resource, action) · `member_branches` (member, branch)

**Setup**
- `branches` (name, address, geo, phone, whatsapp_e164, opening_hours jsonb, business_day_cutoff, active)
- `rooms` (branch, name, type, capacity, active) · `resources` (branch, name, quantity)
- `service_categories` · `services` (category, name/desc en+ar, buffer_before/after, room_types[], resources[], therapists_required, online_bookable, active)
- `service_variants` (service, duration_min, price_aed_incl_vat)

**Staff / HR**
- `staff` (user?, display_name, gender, photo, branches[], employment jsonb, base_salary, commission_rule, active)
- `staff_skills` (staff, service) · `shift_templates`, `shifts` (staff, branch, tstzrange) · `leave` · `time_clock`
- `rotation_queue` (branch, business_date, staff, position, status)
- `staff_documents` (staff, type, number, expiry, file) · `salary_advances` · `payroll_runs` / `payroll_lines`
- `commission_rules` · `commission_entries` (staff, sale_line, amount, period)

**Clients**
- `clients` (name, phone_e164 unique/tenant, language, birthday, gender, nationality, source, tags[], preferences jsonb,
  blocklisted, no_show_count, marketing_opt_out_at, first_visit_at, last_visit_at)
- `intake_templates` (fields jsonb, waiver_text en/ar, version) · `intake_submissions` (client, booking?, answers, signature, pdf_file, signed_at)
- `treatment_notes` (booking_item, staff, text)

**Booking**
- `bookings` (branch, client, source walk_in|online|whatsapp|instagram|phone|ai_agent|gbp, status, business_date, ref_code, notes, created_by)
- `booking_items` (booking, service_variant, staff[], room, period tstzrange, price)
- `reservations` (resource_kind staff|room|resource, resource_id, period tstzrange, booking_item)
  `EXCLUDE USING gist (tenant_id WITH =, resource_kind WITH =, resource_id WITH =, period WITH &&)`
  (multi-capacity resources: one row per unit)
- `waitlist`

**POS & money**
- `sales` (branch, client?, booking?, number (sequential per tenant/year), invoice_kind simplified|full, subtotal, vat, total, status, business_date)
- `sale_lines` (kind service|product|package|gift_card|membership, ref_id, qty, unit_price, vat_rate, discount, staff)
- `payments` (sale, method cash|card_terminal|bank_transfer|gift_card|package_credit|other, amount, reference)
- `tips` (staff, sale, amount, method) · `refunds` + `refund_lines` (per sale line; prepaid: per card/package) · `promo_codes`
- `packages` (definition) · `client_packages` (balances, expires_at) · `package_redemptions`
- `gift_cards` (code, value, balance, expires_at) · `gift_card_txns`
- `membership_plans` · `client_memberships`
- `day_closes` (branch, business_date, opening_float, expected_cash, counted_cash, variance, totals jsonb, closed_by)
- `expenses` (branch, category, vendor, amount, vat, paid_via, receipt_file, ocr jsonb, date)

**Inventory**
- `products` (kind retail|consumable, sku, unit, cost, price) · `stock_levels` (branch, product, qty)
- `stock_movements` (type purchase|sale|consumption|adjustment|transfer) · `service_consumables` (service_variant, product, qty)

**Ledger**
- `ledger_accounts` (seeded chart of accounts, editable) · `journal_entries` (date, source_type, source_id, memo, locked)
- `journal_lines` (entry, account, debit, credit) — immutable; corrections by reversal · `period_locks`

**Comms & marketing**
- `message_templates` (kind, lang, body) · `outbox` (client, kind, text, link, status queued|opened|sent|skipped, due_at, assigned_to, campaign?)
- `segments` (definition jsonb) · `campaigns` (segment, template, stats)
- `reviews` (source google, external_id, rating, text, reply_text, reply_status draft|approved|posted|failed)

**Social & AI**
- `social_accounts` (platform instagram|gbp, external_id, token_enc, expires_at, scopes, status)
- `social_posts` (platform, type feed|carousel|reel|story|gbp_post, caption, media[], status draft|pending_approval|scheduled|published|failed, scheduled_at, external_id, ai_run?)
- `conversations` (channel ig_dm|ig_comment, external_thread_id, client?, mode bot|human|closed, last_customer_msg_at, assigned_to)
- `conversation_messages` (direction, sender customer|bot|staff, text, external_id, at)
- `ai_agent_settings` (agent_key, enabled, mode approve|autopilot, tone, rules, monthly_budget_aed)
- `ai_runs` (agent_key, trigger, input_ref, output, tool_calls jsonb, status, tokens, cost, approved_by)
- `brand_profile` (voice, do/don't phrases, en/ar samples) · `media_assets` (r2_key, kind, w/h, alt_en/ar, source upload|ai)

**Site & SEO**
- `sites` (template_id, theme jsonb, locales[], default_locale, settings) · `site_globals` (header, footer, announcement bar, floating buttons)
- `pages` (site, slug, kind, title en/ar, visibility) · `page_versions` (page, puck_data, schema_version, status, label, created_by)
- `site_templates`, `section_presets` (platform-owned) · `saved_sections` (tenant, data, is_global) · `media_assets` shared with social
- `redirects` · `seo_meta` (page, locale, title, description, og_image, schema jsonb) · `seo_audits`

**Analytics**
- `web_events` — **partitioned by month**, raw kept 90 days: (site, session_hash, type pageview|block_view|click|booking_start|booking_complete|wa_click|ig_click,
  path, block_id, block_type, element, referrer, utm jsonb, device, country, ts)
- Rollups: `web_daily_pages`, `web_daily_blocks`, `web_daily_funnel`, `web_daily_sources`
- Business KPIs from materialised views refreshed by worker.

---

## 7. AI layer (BytePlus ModelArk)

**Gateway** (`packages/ai`)
- OpenAI-compatible Chat Completions: `POST https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions`, `Authorization: Bearer $ARK_API_KEY`.
  Keys are region-bound; GLM/Seed-pro/Seedream need **ap-southeast** (EU region only serves seed-2-0-lite).
- **Model IDs live in `ai_model_config`, never in code** — IDs carry date suffixes and get retired within months.
- Never use the `/api/coding/v3` base URL (bills a different plan).
- Every call: budget check → queue (pg-boss, per-model rate limit) → call → zod-validate → meter (`ai_usage`) → audit (`ai_runs`).
- Prompt caching for the stable tenant context (services, prices, hours, FAQs, brand voice); cache hits ≈ 20% of input price.
- **Flex tier** (≈ 50% off) for non-urgent batch jobs (SEO, blog drafts, weekly insights).
- Default AI budget **USD 25 per tenant per month** (typical estimate USD 5–10: ~1,500 DM turns, 30 posts, 60 images, a few reels);
  super-admin adjustable; agents pause and notify the owner when the budget is reached.

**Default models (super-admin can change per agent)**

| Use | Model ID (2026-10) | Why | USD / 1M in·out |
|---|---|---|---|
| DM / comment / review replies, DM-to-booking, classification | `seed-2-0-lite-260428` | tool calling **+ json_schema structured output**, 30K RPM | 0.25 · 2.00 |
| Content: captions, SEO pages, blog drafts, site generation, weekly insights | `seed-2-0-pro-260328` | strongest Seed; tool calling (no structured output → zod + 1 retry) | 0.50 · 3.00 |
| Cheap tasks: translation EN↔AR, alt text, tagging | `seed-2-0-mini-260428` | structured output, cheapest | 0.10 · 0.40 |
| Images (posts, stories) | `dola-seedream-5-0-flash-260915` (default), `dola-seedream-5-0-pro-260628` (hero) | | 0.018 / 0.045 per image |
| Video (reels) — opt-in, quota | `seedance-1-0-pro-fast-251015` or `dreamina-seedance-2-0-mini-260615` @720p | async task API | ≈ 0.02–0.08 per second |
| Optional alternative | `glm-5-2-260617` | selectable, not default (no structured output, 500 RPM shared) | 1.40 · 4.40 |

- Generated image/video URLs **expire after 7 days** → copy to R2 immediately. Instagram needs JPEG.
- Vision input (receipt OCR, photo understanding) — confirm which Seed 2.0 variant accepts images *(verify in P3)*.

**Agents** (all: approve-first by default → autopilot toggle, brand voice EN/AR, neutral tone, tool allowlist, audit, budget, kill switch)

| Agent | Does | Phase |
|---|---|---|
| Site generator | IG/GBP data → services, copy, theme, page JSON | P3 |
| SEO | meta/OG/schema.org (DaySpa/LocalBusiness/Service/Review) per locale on publish, sitemap, internal links, alt text, weekly audit, blog drafts, Search Console submit | P3 |
| IG content | content calendar, captions EN/AR, hashtags, Seedream images or tenant photos, scheduled publishing | P3 |
| IG DM | answers prices/hours/location/services, **DM-to-booking**, hand-off to human inbox, neutral replies to inappropriate messages | P3 |
| IG comments | public reply + one private reply per comment (≤ 7 days) | P3 (needs Advanced Access) |
| GBP | review replies, offer/event posts, "Book" link | P3 |
| Slot-filler | morning/midday: finds idle capacity today/tomorrow → drafts IG story + builds outbox list of best-match opted-in clients | P3 |
| Insights | weekly plain-language business digest (revenue, utilisation, best/worst services, block analytics suggestions) EN/AR | P3 |
| Receipt OCR | expense photo → vendor, date, amount, VAT, category | P3 |

---

## 8. Integration constraints (checked 2026-10-06)

**Instagram (Instagram API with Instagram Login — no Facebook Page needed)**
- Permissions: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.
- Other businesses' accounts need **Advanced Access via App Review**, and **Business Verification** of the platform company (trade licence).
  Pilot can start as an app **tester** (Standard Access) for publishing + DMs.
- Webhooks need the app in **Live mode**; comment/mention webhooks need Advanced Access and a **public** professional account.
- Bot DMs only within **24 h** of the customer's last message; `HUMAN_AGENT` tag (separate review) lets humans reply up to 7 days.
  DM text ≤ 1000 bytes; customer must message first.
- Private reply to a comment: one per comment, within 7 days.
- Publishing: 100 posts / 24 h per account; images JPEG; carousel ≤ 10 items; reels and stories supported.
- Long-lived tokens expire in 60 days → refresh job.
- **Start Business Verification + App Review in Phase 0** (weeks of lead time; needs privacy policy, data-deletion URL, screencast per permission).

**Google Business Profile**
- API access requires an application from someone who is owner/manager of a GBP **verified and active ≥ 60 days with a website** →
  use the pilot spa's profile (add yourself as manager). Quota is 0 until approved (then 300 QPM); no published turnaround.
- Reviews: v4 `reviews.list` / `reviews.updateReply`. Posts: v4 `localPosts` (standard, CTA, event, offer).
- "Book" button: Place Actions API (`placeActionLinks`, type `APPOINTMENT`).
- **Gone:** GBP chat (shut down July 2024), Q&A API (discontinued Nov 2025) → out of scope.
- Until approved: AI drafts the review reply, receptionist copies it into GBP (manual fallback).
- Search Console API: verify `spamanagement.co` once as a Domain property (covers all subdomains); custom domains need a per-tenant DNS TXT.
- Reserve with Google: UAE supported for Appointments Redirect, but it's a partner integration → P4.

**WhatsApp**
- Click-to-send only (see §1.10). Unofficial automation (whatsapp-web.js, Baileys) and bulk messaging get numbers banned.
- Cloud API + Business-app coexistence exists (via Tech Provider onboarding; disables broadcast lists in the app); per-message pricing → P4 option only.

---

## 9. Analytics

**Business (from operational data) — MVP**
Revenue (day/week/month, by branch/service/therapist/payment method), bookings & sources, **utilisation** (therapist hours booked ÷ on shift;
room hours), **revenue per available treatment hour**, average ticket, new vs returning, rebooking rate (≤ 30 days), retention cohorts,
no-show & cancellation rate, peak-hours heatmap, therapist leaderboard (revenue, rebook %, tips), package/gift-card liability outstanding.

**Website (block-level) — P2**
- First-party, **cookieless** tracker (~2 KB): session = hash(IP + UA + site + daily salt). No third-party scripts.
- Every Puck block renders `data-block-id` + `data-block-type`; tracker records block impressions (IntersectionObserver),
  clicks per block/element, scroll depth, booking funnel steps, **WhatsApp clicks** and Instagram clicks (treated as conversions).
- Ingest `POST /api/collect` (sendBeacon) → batched insert into partitioned `web_events` → hourly/daily rollups.
- In the editor: **heat overlay per block** (impressions, CTR, conversion contribution), page funnels, sources/UTM, devices.
- **Attribution:** `?src=ig|gbp|qr|campaign` + UTMs → session → booking `source`. WhatsApp bookings: the prefilled message carries a short ref
  tied to the web session; receptionist links it when creating the booking.
- Insights agent turns this into suggestions ("move Packages above Testimonials; its CTR is 3× on mobile").

---

## 10. Accounting (simple screens, correct core) — P2

- **Double-entry ledger**, immutable, auto-posted by `packages/core` from operational events; owners never need to see debits/credits.
- Seeded chart of accounts: Cash (per branch), Bank, Card clearing, Service revenue, Retail revenue, VAT payable, Gift-card liability,
  Package/membership liability (deferred revenue), Tips payable, Commission payable, Salaries, Commissions expense, Rent, Utilities,
  Supplies/consumables, COGS, Marketing, Staff accommodation & transport, Visa/licensing fees, Bank charges, Other.
- Postings: sale (revenue + VAT), payment (cash/bank/card clearing), gift card/package sale → liability, redemption → revenue,
  tips → payable, commission accrual, expense, stock purchase/consumption (COGS), refunds by reversal.
- VAT: 5% default, prices VAT-inclusive, tenant TRN on invoices, sequential numbering, simplified vs full tax invoice template,
  quarterly VAT summary, rolling 12-month turnover indicator.
- Screens: Daily close (MVP), Expenses (receipt photo; OCR in P3), P&L by month/branch, cash flow, balance snapshot (cash, bank,
  liabilities), therapist payouts, VAT summary, period lock, export CSV/Excel for the accountant.

---

## 11. Site builder — modular, multi-template, granular control

### 11.1 Principles
- **Content ≠ presentation.** Block content (text, images, links per locale) is stored apart from style props bound to theme
  tokens → switching template keeps all content.
- **Beautiful by default, granular when wanted.** Every control starts at the theme value; owners can override at any level;
  every control has "Reset to theme". Curated choices first, exact values (px, hex, custom font) behind an "Advanced" toggle.
- **Guard rails, not walls.** All layout primitives are responsive by construction (can't overflow on mobile); contrast checker
  warns on unreadable text; preflight checks before publish.
- **Puck is the engine** (`@puckeditor/core`: drag & drop, `slot` nesting, layers tree, history, viewports, per-block permissions,
  UI overrides). We build: responsive style fields, templates, presets, data-bound blocks and our own editor chrome (§12 style).

### 11.2 Templates
- **8 full-site templates at launch**, each = theme tokens + header/footer + page set + demo content + recommended section variants:

  | Template | Feel |
  |---|---|
  | Zen Minimal | stone & off-white, serif headings, slow fades |
  | Dark Luxury | black & gold, editorial, video hero |
  | Thai Teak | warm wood tones, subtle traditional patterns |
  | Nordic Clean | white & birch, airy sans |
  | Desert Sand | beige & terracotta, Arabic-forward typography |
  | Tropical Bali | greens, organic shapes, soft parallax |
  | Urban Express | bold, price-forward (foot / express massage) |
  | Hotel Spa | premium long-form, rich galleries |

- Page set per template: Home, Services, Service detail, Book, Packages & Gift cards, Team, Gallery, About, Contact, Blog,
  Offer landing.
- **"Try on" gallery:** live preview of each template with the tenant's own logo, services and photos before applying.
- **Switch template any time:** content kept, sections remapped to equivalent variants, side-by-side preview, one-click undo.
- **Section presets library** (~60 designed sections across templates) and **page templates** (e.g. "Ramadan offers",
  "Couples package", "Corporate wellness") added in one click.
- **Saved sections:** tenant saves any customised section; **global sections** (edit once → updates everywhere, e.g. promo bar)
  or detached copies.
- **Template studio (super-admin):** we author templates/presets in the same editor; they're JSON → new templates ship without deploys.
- *Built (P2 templates slice):* 8 built-ins in `components/site/templates.ts` (+ theme tokens `pattern`, `arabicFont`,
  `imageShape`); 24 section presets + 7 page templates in `presets.ts`. Studio rows (`site_templates`, read with the
  platform role — catalogue, no tenant data) override built-ins by key; "save a spa's site" copies live pages, renews
  ids, swaps the spa name for `{name}` and strips images/outside links. Switching stores `sites.template_undo`
  (previous key, theme, replaced drafts) for one-click undo. Copy slots live in node ids (`…--hero`, `--about`,
  `--usp-N-title|text`, `--faq`, `--cta`) and are what the AI site writer (`site_generator` agent) fills — as drafts
  only. Gallery thumbnails are script-less sandboxed iframes.

### 11.3 Customisation layers (global → granular)

| Layer | What the spa can change |
|---|---|
| 1. Theme | palette (primary, accent, surfaces, text — or generate from logo), heading/body fonts (Latin + Arabic pairs or uploaded font), type scale, spacing density (compact / comfortable / airy), corner radius, shadow style, button style (shape, fill/outline/ghost), link style, image treatment (radius, filter), motion intensity + style (fade / slide / scale), favicon, logo variants |
| 2. Global elements | header layout (logo position, menu style, sticky / transparent-on-hero, CTA), mobile menu (drawer / full-screen), footer layout, announcement bar, floating WhatsApp / Book buttons (position, style), sticky mobile action bar |
| 3. Page | content width, background, SEO panel, visibility (live / hidden / draft), page transition |
| 4. Section | layout variant, background (colour, gradient, image, video, pattern + overlay/opacity), padding (token steps or custom), contained vs full-bleed, columns & gaps, alignment, shape dividers (wave / curve / angle), entrance animation (type, delay, stagger), anchor id, show/hide per device, schedule (show between dates) |
| 5. Element | text (inline rich text, heading level, size step, colour, letter-spacing, alignment), buttons (label, action: page / booking / WhatsApp / call / map, style, icon), images (upload, crop + focal point, aspect ratio, alt EN/AR, filter, hover zoom), icons, spacing, per-element animation |
| 6. Advanced (opt-in, owner only) | section-scoped custom CSS (sanitised, no JS), custom class, sandboxed embed block |

- **Every style value is responsive:** base (mobile) → tablet → desktop overrides. The panel shows a dot where a value is
  overridden for the current device; "apply to all devices" clears overrides.
- Copy/paste styles between blocks; duplicate sections across pages.
- Per-block **permissions/locks** (Puck permissions): owner can lock sections; ULM role "Content editor" may edit text/images
  but not styles or structure.

### 11.4 Building blocks
- **Layout primitives** (granular layout, all nestable via `slot`): Section, Container, Grid (1–12 cols per breakpoint, gap),
  Columns (50/50, 33/67, 25/75, 3-up, 4-up), Stack (vertical/horizontal, gap, align, wrap), Card, Spacer, Divider.
- **Elements:** Heading, Rich text, Button group, Image, Gallery / carousel / lightbox, Video (upload / YouTube), Icon + text,
  Checklist, Badge, Price row, Quote, Stat counter, Accordion, Tabs, Map, Social links, WhatsApp button, Enquiry form
  (→ dashboard inbox + WhatsApp), Embed (sandboxed).
- **Smart (data-bound) blocks** — read live dashboard data so prices/hours never go stale: Services menu, Service detail,
  Booking widget (inline / modal / page), Team, Packages, Gift cards, Memberships, Offers, Google reviews, Testimonials,
  Instagram feed, Media-library gallery, Blog list/post, Branches & hours.
- Each block ships 2–4 designed variants plus full layer 4–5 controls.

### 11.5 Responsive editing & output
- Viewport switcher: mobile 375, tablet 768, laptop 1280, desktop 1536, plus drag-to-resize; edits apply to the active breakpoint.
- Per-device show/hide and **stack order on mobile** for columns.
- Mobile-first CSS, fluid type (`clamp()`), responsive `srcset` images, touch targets ≥ 44 px, safe-area insets,
  optional sticky "Book / WhatsApp" bar on mobile.
- **Preflight before publish** (with one-click fixes): missing alt text, low contrast, headings too long on mobile, heavy images,
  broken links, empty sections, missing AR translation.

### 11.6 Editor UX (styled per §12)
- Left: Add (blocks, presets, saved sections) · Layers tree · Pages · Templates. Centre: real-render canvas (iframe).
  Right: properties in tabs **Content | Style | Advanced** with the responsive toggle. Focus mode collapses panels.
- Drag from library or within canvas/layers; inline text editing; drop image to replace; context menu; keyboard shortcuts
  (copy, paste, duplicate, delete, undo/redo, move up/down).
- Autosave; version history with named versions and restore; scheduled publish; shareable preview link + QR to check on a phone.
- EN/AR toggle: per-locale content, automatic RTL mirroring, "copy from English" + AI translate.
- Editing lock: one editor per page at a time (shows who's editing).
- P2: block-analytics overlay. P3: AI assists (write/rewrite copy, section from prompt, Seedream images, layout suggestions from analytics).

### 11.7 Storage
- Page = Puck JSON; each block's props = `{ content: {en, ar}, style: { prop: {base, md, lg} }, advanced }`.
- `sites.theme` (tokens) · `site_globals` · `site_templates` / `section_presets` (platform) · `saved_sections` (tenant).
- `schema_version` per page + block prop migrations, so old pages keep rendering as blocks evolve.
- **Media library** (`media_assets` + public `stored_files`): uploads and AI images are sniffed by magic bytes (no SVG/HEIC),
  re-encoded once with sharp (auto-rotate, metadata stripped, ≤ 2400 px, WebP q82) and referenced as `/files/{id}`.
  `/files/*` is served on every host (proxy pass-through): public = immutable + ETag, private = members only.
  Thumbnails are rendered on demand (`?w=480|960`, in-process LRU + edge/browser cache) rather than stored.
  Uploads go to `POST /files/upload?tenant=` (outside the proxy's 10 MB body buffer; access checked before the body is
  read; streamed 20 MB raw cap). Seedream links (7-day expiry) are copied into the library when a post is
  drafted/approved or via "Save to library"; posts then use the absolute `/files/{id}?f=jpg` URL (JPEG rendition —
  Instagram publishing takes JPEG only). The picker hides unsaved AI links; the delete warning counts pages, service /
  therapist photos and unpublished posts. The worker (`media-prune-ai`, daily) prunes rows whose link expired unsaved.

### 11.8 Rendering & performance
- Published JSON → React Server Components; style props compiled at publish to CSS variables + atomic classes (no runtime style
  calculation); theme = CSS variables on `:root` → instant theme/template switch.
- Scoped custom CSS compiled + sanitised (lightningcss), prefixed with the section id.
- Only interactive blocks ship client JS (booking widget, carousels, motion); everything else is static HTML.
- Self-hosted subset fonts (Latin + Arabic, `font-display: swap`); sharp → AVIF/WebP + blur placeholders.
- Budgets: LCP < 2.5 s on mid-range Android over 4G, CLS < 0.1, INP < 200 ms, ≤ 100 KB JS excluding the booking widget.
- Cached per host + path by tag; Cloudflare edge cache; publish = revalidate tag + purge.

### 11.9 Phasing
- **P1 (MVP):** primitives, 15 core + smart blocks, 3 templates (Zen Minimal, Dark Luxury, Nordic Clean), layers 1–5 with
  responsive spacing/typography/visibility, EN/AR, versions, preview link, template studio (how we build templates).
- **P2:** all 8 templates, section presets, page templates, saved/global sections, template switching, preflight, scheduled
  sections, custom CSS, analytics overlay.
- **P3:** AI assists in the editor.

---

## 12. Admin design system — minimal Swedish modern, fully responsive

Applies to every non-public screen: owner/manager/receptionist/therapist/accountant views, the site editor chrome and super-admin.

### 12.1 Principles
- *Lagom* — just enough: calm, airy, functional; content first; one accent colour; hairline structure instead of boxes and heavy shadows.
- Every screen sits on the same well-padded 12-column grid; consistent rhythm beats decoration.
- Motion explains change (where something came from / went); never decorative-only, never blocks input.

### 12.2 Tokens (final values tuned in the P0 design pass)
- **Colour, light:** background warm snow `#FAFAF8`, surface `#FFFFFF`, subtle `#F3F2EF`, hairline border `#E7E5E0`,
  text `#1C1C1A`, muted text `#6B6A66`, one accent (muted sage `#5E7D6B` or Nordic blue `#3D5A80`), desaturated semantic
  colours (moss success, ochre warning, brick danger).
- **Colour, dark:** graphite `#121211`, surface `#1A1A19`, border `#2A2A28`, same accent lifted for contrast.
- **Type:** Inter (variable) for UI, tabular figures for money/times; IBM Plex Sans Arabic when the dashboard gets AR.
  Scale 12/13/14/16/20/24/32/40, weights 400/500/600 only, line-height 1.5.
- **Space:** 4-pt base, 8-pt rhythm. Page padding 16 (mobile) / 24 (tablet) / 32 (desktop) / 48 (wide). Card padding 24–32.
  Grid gap 24. Section gap 40–48.
- **Shape:** radius 12 cards, 8 inputs, pill chips; no shadow at rest, one soft elevation on hover/overlays.
- **Icons:** Lucide, 1.5 px stroke.
- **Layout:** fluid 12-col grid, max content width 1440; sidebar 248 px, collapsible to 72 px; bottom tab bar on phones.

### 12.3 Micro-animations (`motion`)
- Timing: 120 ms hover/press, 200 ms enter/exit, 280 ms layout; easing `cubic-bezier(0.2, 0, 0, 1)`; springs for drag/sheets.
- Patterns: button press scale 0.98 · card hover lift 2 px · list/stat staggered reveal (30 ms) · KPI number tickers ·
  skeleton → content crossfade · shared-layout tab indicator · calendar drag with spring snap + layout animation on reorder ·
  drawer/sheet spring · toast slide + fade · success check morph · chart draw-in · page transitions via View Transitions API.
- `prefers-reduced-motion` → fades only.

### 12.4 Responsive by role (designed 360 px → 1920 px+)

| Role | Main device | Layout behaviour |
|---|---|---|
| Owner | phone + laptop | Phone: stacked KPI cards, swipe between branches, bottom nav (Home, Calendar, Sales, Reports, More). Laptop: 12-col dashboard, 3–4 KPI cards per row, charts 8/4 split. |
| Manager / Receptionist | desktop or tablet at reception | Resource calendar (therapist/room columns) with sticky time axis and horizontal scroll on tablet; split view calendar + booking drawer; quick-action bar; keyboard shortcuts; WhatsApp outbox side panel. |
| Therapist | phone (PWA) | Today agenda, next-client card, big check-in/out buttons, own earnings; bottom nav; actions in thumb reach. |
| Accountant | laptop | Dense but airy tables, sticky headers, column chooser, filters, export. |
| Super-admin | laptop | Tables + detail drawers. |

- Patterns: tables → stacked cards below 768 px; drawers → full-screen sheets on phones; multi-column forms → single column;
  calendar → agenda list with swipe between days on phones; charts simplify axes on small screens; touch targets ≥ 44 px;
  safe-area insets; tablet landscape and portrait both supported.
- Breakpoints 360 / 640 / 768 / 1024 / 1280 / 1536, plus **container queries** so widgets adapt to their slot, not just the viewport.

### 12.5 Component stack
- shadcn/ui (Radix) restyled to the tokens; TanStack Table for data grids; Recharts styled to tokens for charts.
- **Resource calendar built in-house** on CSS grid + dnd-kit (FullCalendar's resource views are a paid licence).
- A `/dev/kit` route shows every component and token in light/dark at each breakpoint (cheaper than running Storybook).

---

## 13. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Foundations** | Repo, CI/CD, infra, tenancy + RLS, auth + ULM, host routing, signup → subdomain, super-admin skeleton, AI gateway stub, admin design system + responsive role shells, spikes. **Start Meta + Google applications.** | Pilot owner signs up, gets `pilot.spamanagement.co`, invites a receptionist with a role. |
| **P1 MVP** | Branch/rooms/services/staff/shifts, booking engine + calendar + walk-ins + rotation, online booking + WhatsApp confirm, clients + intake/waiver e-sign + notes, POS (recorded payments, tips, refunds), daily close, WhatsApp outbox (confirm/remind), business KPIs, site builder MVP (primitives, 15 core blocks, 3 templates, responsive overrides, EN/AR, template studio), super-admin billing (manual payments), PWA + push. | Pilot runs every booking, walk-in and cash close on the platform for 2 weeks. |
| **P2 Money & growth** | Ledger + accounting screens + VAT, packages/gift cards/memberships, commissions/advances/payroll summary, inventory, document expiry tracker, custom domains, block analytics + funnels + attribution, reviews, segments + campaigns, CSV import, all 8 templates + section presets + saved/global sections + template switching + preflight, data export. | Owner reads monthly P&L and block analytics without help. |
| **P3 AI** | Site generator onboarding, SEO agent, IG content + publishing (Seedream), IG DM agent + DM-to-booking + human inbox, IG comments, GBP reviews/posts/Book link, slot-filler, insights digest, receipt OCR, AI assists in the site editor. | Bookings attributed to AI/IG/GBP sources appear in reports. |
| **P4 Scale** | Stripe (SaaS billing first), WPS SIF export, WhatsApp Cloud API option, Reserve with Google, RU/ZH, dashboard AR, home/hotel service, managed Postgres, second droplet. | — |

Meta/Google approvals run in parallel from P0; the pilot uses tester access during P2–P3.

---

## 14. Phase 0 task list

**You (accounts & approvals — start now, they have lead time)**
1. `spamanagement.co` (canonical since B1) and the old `spamanagement.ae` (kept via `EXTRA_ROOT_DOMAINS`); nameservers → Cloudflare.
2. DigitalOcean account; run the region ping test from the pilot spa (command provided in P0).
3. Cloudflare account (Free); later enable Cloudflare for SaaS on the zone.
4. Meta: business portfolio for the platform company → **Business Verification** (trade licence) → developer app with Instagram API (Instagram Login); add the pilot's IG (professional, public) as tester.
5. Google: Cloud project; get **Manager** on the pilot's GBP; submit the GBP API Basic Access form.
6. BytePlus ModelArk (ap-southeast): enable Seed 2.0 lite/pro/mini + Seedream; create `ARK_API_KEY`.
7. Resend account (verify `spamanagement.co` for staff email).
8. Pilot data: services & prices, rooms, staff list & shifts, hours, logo/photos, client list if any.

**Claude (code)** — status 2026-10-06
1. ✅ Monorepo (pnpm, Turborepo, TS strict, **Biome**, Vitest, Playwright), `CLAUDE.md` commands, SessionStart hook.
2. ✅ `packages/db`: Drizzle 0.45 + Postgres 16, owner/platform/app roles, per-role RLS policies, `withTenant()`, seed, isolation tests.
3. ✅ Auth & ULM: Better Auth (email+password, TOTP), own RLS-scoped members/roles/invitations, permission matrix, audit log
   (branch scoping data model in place; branch-filtered screens arrive with P1 calendar).
4. ✅ Host routing: `proxy.ts`, reserved slugs, LRU host cache, placeholder tenant site (subdomain + custom domain), 404.
5. ✅ Signup → tenant + subdomain + owner; dashboard shell; installable PWA manifest (push notifications in P1).
6. ✅ Super-admin: overview, spas, subscription editing, manual payments, VAT invoices, **editable plans/prices**,
   **editable company details**, AI model config, audit log, super-admin access to tenant dashboards (audited).
7. ✅ Worker: pg-boss, Dubai-time cron registry, structured logs, nightly `pg_dump` → R2.
8. ✅ AI gateway: ModelArk client, `ai_model_config`, budget check, metering, structured output + retry, smoke script.
9. ✅ Infra: Dockerfiles (validated), production compose (validated end-to-end locally), CI + deploy workflows, `deploy/README.md`.
10. ⏭ Spikes moved to the start of P1 (they need the builder work / pilot PC / Cloudflare zone): Puck 0.23 RTL + responsive style
    fields · Cloudflare for SaaS → Tunnel origin · WhatsApp Desktop/Web/wa.me UX.
11. ✅ Admin design system: tokens (light/dark), motion presets, responsive shells (sidebar 248 / rail 72 / bottom tabs), `/dev/kit`.

**P0 implementation notes (deviations from the original plan)**
- Biome replaces ESLint + Prettier (one fast tool).
- Tenant memberships, roles and invitations are our own RLS-scoped tables instead of Better Auth's organization plugin.
- RLS uses per-role policies (`spa_app` tenant-scoped, `spa_platform` all rows) — no BYPASSRLS, portable to managed Postgres.
- The worker and pg-boss use the owner role (pg-boss manages its own schema); web never does.
- Backups go to Cloudflare R2 (free tier); Sentry is deferred to P1, before the pilot goes live.

### 14.1 Build status — P1, P2 and P3 complete (2026-10-06)

| Area | Status |
|---|---|
| P1 setup | ✅ services/variants/categories, rooms, staff + skills + shifts, opening hours (past midnight) |
| P1 calendar | ✅ resource day view (therapists/rooms), booking sheets, drag-to-reschedule, walk-ins + rotation, agenda on phones |
| P1 clients | ✅ CRM, visit history, notes, intake/waiver templates with e-signature |
| P1 POS | ✅ recorded payments (split), tips, receipts (simplified tax invoice, WhatsApp share), voids/refunds, daily close (Z-report) |
| P1 WhatsApp outbox | ✅ click-to-send queue (wa.me / Web / Desktop), EN/AR templates, confirm/remind/thank-you |
| P1 online booking | ✅ public `/book` flow on subdomain/custom domain, EN/AR, .ics, WhatsApp confirm |
| P1 KPIs | ✅ business dashboard on the tenant home |
| P1 site builder | ✅ Puck editor, 18 blocks, 3 templates, per-device style, EN/AR, versions, preview |
| P2 accounting | ✅ double-entry ledger (DB-enforced), P&L, VAT (Form 201 figures), balances, expenses, journal + CSV, period close |
| P2 packages & gifts | ✅ package definitions, memberships, gift cards, promo codes; sold and redeemed through POS |
| P2 payroll | ✅ commission accrual, advances, monthly run, WPS SIF export (pulled forward from P4) |
| P2 inventory | ✅ products, receive/count, consumables per treatment drawn on completion, retail COGS |
| P2 web analytics | ✅ cookieless tracker, block-level views/clicks, funnel, first-touch sources, hourly rollups, 90-day retention |
| P3 AI | ✅ AI studio: receptionist chat (books via tools), IG captions + Seedream images, review replies, SEO, slot filler (worker) |
| P2 custom domains | ✅ connect own domain (TXT + CNAME, auto checks, primary), Cloudflare for SaaS optional, Caddy on-demand TLS on the droplet; buy a domain via Namecheap (super-admin approves) |
| P2 campaigns | ✅ segment builder, WhatsApp click-to-send campaigns with offer codes, 7-day cap, 500/campaign, results (bookings within 14 days) |
| P2 data | ✅ CSV import wizard (clients, menu, products incl. opening stock), CSV/zip exports |
| P2 site builder | ✅ 8 templates + section presets, template switching with undo, template studio, saved/global sections, version history, preflight (editor and Publish all), scheduled publish, share previews + QR, media library with image variants |
| P2 engage | ✅ staff/business document tracker with expiry pushes, web push (PWA), daily digest |
| P3 AI | ✅ AI site writer, Instagram publishing + DM/comment inbox with AI drafts/autopilot, GBP review sync/replies + local posts, receipt scanning, weekly insights, AI assists in the editor |
| Still open | Meta + Google API approvals (code ready; set META_* / GOOGLE_*), Reserve with Google, notification centre, low-stock pushes |

Deployed on one DigitalOcean droplet (blr1, Compose + Caddy) with path routing (`/app`, `/admin`, `/s/{slug}`) on an sslip.io hostname
until the domain is wired in; the switch to `spamanagement.co` (old `.ae` kept via `EXTRA_ROOT_DOMAINS`) is the owner checklist in deploy/droplet/README.md (B1).

### 14.2 P2/P3 implementation decisions (recorded at integration)
- **Instagram:** AI replies are stored as `ai_draft` messages (one pending draft per thread); delivery errors on
  `conversation_messages.error`; `conversations.read_at` drives the unread dot; the inbox polls every 20 s. Each comment is
  its own conversation. Autopilot replies run in the worker job `instagram-reply` (B6, 2026-10-08, every minute): the webhook stores the
  message + an `instagram_reply_queue` row (RLS, PK = message id → idempotent) in one transaction; the job claims due
  rows (lease + SKIP LOCKED), answers, deletes; failures back off 30 s → 30 min, give up after 5 (`failed_at`). The web
  app has no pg-boss, no owner URL and no `after()` path. Approve mode creates *pending* bookings the spa confirms.
- **Campaigns:** the 7-day cap counts other campaigns' messages within ±7 days of the send (skipped ones ignored); max 500
  recipients; result = non-cancelled bookings within 14 days of a sent/opened message; archiving withdraws unsent messages.
  Segments always exclude never-visited clients and clients tagged `no-marketing`. Campaign messages are outbox kind `custom`
  with `campaign_id` (labelled "Campaign" in Messages). Hourly `campaigns-housekeeping` job.
- **Data import:** opening stock posts Dr 1200 Inventory / Cr 3000 Owner's equity (one entry per 500-row batch,
  sourceType `stock_adjustment`); stock changes on existing products go through adjustStock (5100). Non-UAE phones are row
  errors; rows without a phone import and de-dupe by name. Import history lives only in `audit_log` (≤ 500 row errors, no
  raw values). Uploads use route handlers (server actions cap bodies at 1 MB).
- **Site editor:** section style props live in `advanced`; `@spa/services/site-kit` holds client-safe code (preflight, CSS,
  schedule, tree); the no-login share preview is `/website/preview` on the app host (`website` is a reserved slug). Global
  sections update live pages immediately. "Publish all" runs the same server preflight as the editor.
- **Files:** private files are served from `/files/{id}` to members only; document scans need `staff.manage`, receipt scans
  `accounting.view|manage`. Caddy caps request bodies at 25 MB.
- **Push:** VAPID keys live in the droplet secrets overlay; worker notifications send app-relative URLs and the service
  worker (registered with `?base=/app` in path routing) adds the surface prefix.

### 14.3 Marketing site & card billing (2026-10-06)
- Marketing site: `/`, `/features`, `/website-builder`, `/pricing`, `/contact` (apps/web/src/app/marketing, shared
  `components/marketing`); feature copy lives in `components/marketing/content.ts`.
- **"C · Bold product-led" look + motion (owner, 2026-10-08)** — replaces Mint Cloud (rejected by the owner;
  `docs/design/01-mint-cloud.*` kept for reference only). Only look and motion changed: pages, sections, copy, plans,
  buttons, links and content sources are unchanged. Light ground only. Theme = `marketing/marketing.css`, scoped to
  `.mkt` (plus `html/body:has(.mkt)`): white ground, #0B0B0F text and near-black bands (`.mkt-dark`, #17171D cards,
  #C2C2CC text, drifting green glow in CSS), one accent #0F6B4B (white text), lime #D9F26A kicker chips/bars, greys
  #F1F1F4/#3A3A44/#5A5A66; Space Grotesk 700 tight-tracked headings + DM Sans body (`@fontsource-variable/space-grotesk`
  + `dm-sans`, loaded in the marketing layout); 12px-radius buttons, 16–20px cards; product visuals (home calendar,
  studio demo) in a dark device bezel (`.mkt-device` > `.mkt-screen`); hero pages get decorative depth fragments
  (`HeroDepth` in shell.tsx). Motion = one client component `components/marketing/motion.tsx` (imports only
  `useRef`/`useEffect`, driven by DOM queries + data attributes so it also runs on exported static HTML):
  `[data-tilt]` frames start tilted back (perspective 1200px, rotateX 22°, scale 0.9; 13° on phones) and straighten as
  their centre reaches mid-viewport, reversing on scroll up, with gentle mouse-follow on desktop; `[data-rise]` blocks
  rise with a scroll-linked 3D tilt + stagger (`="card"` also leans to the pointer); `[data-depth]` hero layers
  parallax with scroll/mouse; `[data-mkt-nav]` hides on scroll down, returns on scroll up (CSS scroll-timeline fade
  without JS); a relaxing aurora canvas (greens, teal, mint, a touch of lime and sky, 24–40 s cycles, slight scroll
  pull) behind every page. rAF loop writes transform/translate/opacity only from cached layout offsets; pauses while
  the tab is hidden. Motion runs for every visitor, including OS reduced motion (owner decision 2026-10-07). The
  marketing pages no longer use scroll scenes (the engine stays for public spa sites).
- Positioning: **automation — "More bookings. Less work."** Copy only claims what is automated in code; WhatsApp
  messages are described as written and queued automatically, sent by the spa in one tap (click-to-send stays locked).
- Stripe Checkout for **platform invoices only** (SaaS billing; overrides "Stripe later"); client payments stay recorded-only.
- **Redesign (owner, 2026-10-08):** new visual style + better UX + mobile-first polish for the marketing site only (backend
  unchanged). Brand domain spamanagement.co. Main CTA = WhatsApp chat with sales (number from super-admin company
  settings). Owner rejected 3 generated mockups, then Mint Cloud; current look = "C · Bold product-led" (above).

### 14.4 Website Studio — sites are a bespoke service (decided 2026-10-07)
- **Super-admin builds every spa's site** (overrides §11 self-serve editing). Spa members get a read-only Website
  page: live link, preview, status and **Request a change** (`site_change_requests`) — no approving (R1, 2026-10-08).
  Editing, approving and publishing = `studioGuard`/`isStudio` (platform admin acting on the spa, or a platform admin
  who is also a member). Flow: `sites.studio_status` building → review (studio sends) → approved (studio only); the
  studio can withdraw or reopen; a request made during review sends it back to building. Admin → Websites lists status, live pages and open requests; "Open studio" enters
  the spa's existing editor. Live data blocks (prices, team, hours) keep the site current without edits.
- **Superseded by §18.1 (2026-10-09):** spa members no longer preview/review or send change requests. Their Website
  page is **Services & prices** (`website/services-prices.tsx`): each service with its durations/prices, a menu-only
  edit sheet (name, description, durations, prices, price visibility — the shared `ServiceSheet`/`saveServiceAction`,
  `services.manage`), a link to the live site. The site's service/price blocks read services live (`site/data.ts`), so
  edits show without a republish. Studio status (review/approve) and publishing are studio-only and unchanged; the
  old requests list stays visible to the studio for history; `requestChangeAction` is removed.
- **Prompt editing (2026-10-09, §18.2):** Studio "Ask AI to edit" and the Claude MCP connector (`/api/mcp`) edit drafts
  through one ops layer (`site-edit.ts`); only `SITE_AI_EDITOR_EMAILS` super-admins with 2FA; theme/renames draftable.
- Scroll effects per section (`scene` on every band: reveal, rise, assemble, flip, depart; `auto` = theme entrance)
  via the shared scroll-scenes engine on public pages (not editor/preview). Spa sites ignore OS reduced motion.
- Roadmap: **B** section-type registry (shared content schema per type + `variant`), 10 core types × 30 variants
  first, style kits (palette + Latin/Arabic font pairs), Impeccable shape/craft/audit at build/QA time, screenshot QA
  360/768/1280 EN+AR, Design Lab gallery. **C** intake form + crawler (sitemap-first, ≤25 pages, depth 2, SSRF guard;
  headless Chromium in the worker for JS sites) → Seed 2.0 spa profile; brand colours; image/video import to DO
  Spaces with ffmpeg transcode + posters; consent checkbox. **D** AI composer pg-boss job (sitemap → section/variant
  picks validated against schemas → style kit → EN/AR copy → Seedream images; per-section regenerate; locks on edited
  sections). AI cost is platform-paid (part of the service). **E** extended preflight, perf budgets, visual regression.

### 14.5 Domain-agnostic links (decided 2026-10-07)
- Navigation and sign-in URLs are built per request from the visitor's platform domain (`server/origin.ts`:
  `requestUrls`, `appUrl`, `adminUrl`, `tenantSiteUrl`, `marketingUrl`); shared/stored addresses are the exception below. Platform domains = `ROOT_DOMAIN` (canonical) + `EXTRA_ROOT_DOMAINS`;
  any other Host (forged, or a spa custom domain) falls back to the canonical domain. Never bake a domain in at build time.
- Proxy routing, Better Auth (dynamic `baseURL` with an exact allowed-hosts list + canonical fallback, so reset links
  can't be host-poisoned), custom-domain validation and the on-demand TLS gate all accept every platform domain.
- Shared/stored/sent addresses use the canonical domain (`canonicalUrls()`): a spa's site address (`publicSiteUrl`,
  GBP booking link, campaign and WhatsApp links), invites, preview share links, public file URLs for Instagram.
- OAuth (Meta, Google) runs entirely on the domain it starts on — session and nonce cookies are per host — so each
  platform domain's callback URL is registered with the provider. No visitor → canonical `APP_URL`: spa CNAME target,
  Meta webhooks/deauthorize/data-deletion, worker jobs.

### 14.6 Spa dashboard redesign — Be Relax CRM (decided 2026-10-08)
- **Colours + fonts superseded 2026-10-09 (owner): brand look, see §18.6.** Layout, density and menu stay as below.
- Design `docs/design/be-relax-crm.html`, spec + gap analysis `docs/design/crm-spec.md`. Same design for every spa; the
  sidebar shows the spa's own logo + name (logo captured at onboarding/settings). Super-admin console unchanged.
- ~15–20% more compact than the HTML; light only. Menu per the design + a Sales entry.
- Languages EN + Thai (no Arabic in the dashboard): every UI string, toast, validation and server message, dates and
  numbers; per-user preference. Typed names (staff, clients, treatments, products, packages, rooms…) never translated.
- Rule-safe wording: WhatsApp stays click-to-send ("queued, one tap to send"); deposits are recorded only; the spa's
  website card is "request a change" (studio edits sites). No AI overage billing (agents pause at budget).
- Phases (one PR each, owner approves merges): 1 shell + tokens + i18n + logo + menu · 2 every screen redesigned and
  translated · 3 new: Bookings list, Automations, Coming next, global search, notifications, Ask AI, audit-log viewer,
  calendar week/month. Supersedes §12 for the spa dashboard and "dashboard AR P4".
- **Phase 1 ✅ (2026-10-08)** — shell + tokens + i18n + logo + menu. Implementation decisions:
  - **Tokens**: `apps/web/src/app/dashboard/[tenant]/crm.css`, imported by the tenant layout, which wraps the dashboard
    in `.crm`. Tokens sit on `:root:has(.crm)` (so Radix portals + the root Toaster get them) and are lifted under
    `[data-crm-off]` (site editor + preview overlays keep their chrome). Compact density = `--crm-*` + `--ui-*`
    variables; the UI kit (`components/ui`) reads `--ui-*` hooks whose fallbacks are its old sizes, so super-admin and
    auth pages render exactly as before. Light only; Inter + Noto Sans Thai (`@fontsource-variable/noto-sans-thai`,
    the whole UI switches to it when `lang=th`; Thai text never below 12 px; ≥ 40 px controls on touch).
  - **Shell**: `components/shell/spa-shell.tsx` (AppShell/BottomNav stay for super-admin). Phone ≤ 860 px = drawer
    (supersedes §12's bottom tab bar for the spa dashboard). Menu per the design + Sales; pages without a design home
    are grouped under their item as section tabs below the top bar (Inbox: WhatsApp · Instagram · Campaigns;
    Services: services · packages · inventory; Team: staff · access · documents; Marketing: social posts · analytics
    · AI studio; Website: site · media). AI studio sits under Marketing, not Settings, so AI roles without
    `settings.manage` (receptionist) never get a Settings item. VAT & payroll → /payroll (VAT stays in Accounts until
    Phase 2). Plan card: plan + renewal/trial end for `billing.view`; AI meter (month `ai_usage` ÷ `ai_budget_usd`)
    also for AI roles. Home greeting moved from the page header to the top bar.
  - **i18n API**: catalogue in `packages/core/src/i18n` (`en.ts` source, `th.ts` typed — missing key = type error;
    test checks keys + placeholders). Server: `getT()` / `getI18n()` (`apps/web/src/i18n/server.ts`); client:
    `useT()` / `useI18n()` under `<I18nProvider>`; formatting `fmt` (`createFormat`). Action results carry English
    text + optional `key`/`params` (`ok`/`fail` accept keys; `failDomain(e)`; `DomainError(message, code, { key,
    params })`); the client renders keys in the viewer's language. Phase 2 only adds keys/namespaces and converts
    call sites (pages, `toast.error(r.error)` → `resultText`, zod messages → keys, worker/notify in the recipient's
    locale).
  - **Locale storage**: `user.locale` (`'en' | 'th'`, default `en`; Better Auth additional field, migration 0016) +
    `spa_locale` cookie for pages before sign-in; read from the user row each request.
  - **Logo**: `tenants.logo_file_id` → public `stored_files` (purpose `logo`, 512 px WebP), optional at sign-up and in
    Settings; sidebar falls back to initials on the accent gradient.
  - **Thai copy** is written to read naturally but needs a native Thai speaker's review before launch.
- **Phase 2 ✅ (2026-10-08)** — every spa-dashboard screen on the crm kit (`components/crm`, `crm-kit.css`, guide
  `docs/design/phase2-kit.md`) and translated EN + TH (per-namespace catalogue `packages/core/src/i18n/{en,th}/<ns>.ts`;
  enum/permission labels; services' English DomainErrors mapped web-side in `apps/web/src/i18n/domain-errors.ts`, test fails
  on unmapped messages; deterministic `fmt` for hydration safety). Design elements without a data source were omitted,
  not faked (activity timeline, journey stages, week/month calendar, ratings, deposits, IG followers, AI chat stats,
  FTA export, 2FA policy, mask-phones toggle, audit viewer) — they need services (Phase 3 / §14.7–14.8). Verified: full
  e2e 36/36 on the production build. Thai copy still needs native review.
- **Phase 3 — calendar Week/Month + nav badges + bell digests (2026-10-09)**:
  - Calendar `?range=week|month` (Day = no param; `RangeSeg` Day/Week/Month links, Today, prev/next ±7 days / ±1 month).
    Week = Mon–Sun business days × hours (therapist/room columns stay Day-only), status-coloured blocks (`blockStyle`);
    click → Day view `?date=&open=<bookingId>` opens the booking sheet (then `open` is dropped from the URL). Month =
    Mon-start grid (adjacent days muted): bookings count (amber when some are pending), booked value (AED), occupancy bar
    (booked therapist-minutes ÷ shift minutes); click → Day view. Phones: Week = vertical day list, Month = counts only.
    Data: services `loadCalendarRange` (one booking query by stored `business_date` range on `bookings_branch_day`, + one
    shifts query clipped to cutoff windows; ≤ 62 days); therapists / non-managers with a linked profile = own only.
  - Sidebar badges (crm-spec §2.1 ③): Calendar = today's bookings, Bookings = today's pending, Inbox & follow-ups = due
    WhatsApp outbox + unread IG threads; services `navCounts` (one SQL of scalar subqueries, today per branch cutoff in SQL),
    web `server/nav-counts.ts` (React `cache`, branch + own-only + permission filtered); hidden at 0; sr-only label
    `nav.count.*`. Layout data, so it refreshes on full navigation / revalidate (not on every soft nav). Waitlist isn't
    in the menu → no badge.
  - Weekly insights + daily digest now also write bell rows (`weekly_insights` → reports.view, `daily_digest` →
    calendar.manage; dedupe per Monday / business date; link = overview) via `notify()` → push in each recipient's
    locale; the digest no longer needs push configured.

### 14.7 Work split (owner, 2026-10-08)
- Track A (Claude): spa dashboard UI (`apps/web/src/app/dashboard/[tenant]/**`, `apps/web/src/components/**`,
  `packages/core/src/i18n/**`) — §14.6 Phase 2, then Phase 3 screens on Track B's services.
- Track B (partner): `packages/services`, `packages/db`, `apps/worker`, `packages/auth`, `deploy/`. Items B1 domain switch ✅ (code + checklist in deploy/droplet/README.md; owner runs DNS/env steps)
  to spamanagement.co · B2 notifications (table + worker pushes) · B3 per-spa automation switches · B4 global search,
  bookings list, audit-log query · B5 waitlist, merge duplicate clients, equipment resource (`resource_kind`), staff time
  clock + leave, embeddable booking widget · B6 restore drill, Instagram autopilot as a pg-boss job.
  *B2 built (X3, 2026-10-08): migration 0022_notifications; bell + /notifications; producers online booking, pending
  booking, low stock, document expiry, AI drafts, overdue invoice/payment reminder; push in each recipient's locale.
  See CODEMAP "Notifications".*
- **B3 ✅ (2026-10-08):** 9 switches in `tenants.settings.automations` (missing = on; no new switches table), Automations
  page in the System menu (`settings.manage`; backups + domains/SSL shown "Always on"), tenant `job_runs` log (migration
  0023) shown as "Last 24 hours". Switches only stop QUEUEING (outbox) / pushes — click-to-send unchanged. Details: CODEMAP
  "Automation switches".
  *B5.1 waitlist + B5.2 merge duplicate clients built (X6, migration 0025_waitlist_merge; CODEMAP "Waitlist" /
  "Merge duplicate clients"): waitlist per branch + business date + optional service and time window; a freed slot
  (cancel / no-show / reschedule) marks matching entries notified and queues a `waitlist_slot` WhatsApp message
  (click-to-send); staff book an entry through createBooking. Merge = suggest (phone key / name) → preview → one
  transaction moving every client FK, merged row deleted, ledger untouched, new permission `clients.merge`.*
  *Built (X7, migration 0026_equipment_timeclock): B5.3 equipment as a bookable resource (Services & rooms →
  Equipment; services require types; reserved via `reservations` like rooms; calendar flags uncovered equipment) and
  B5.4 time clock + leave (`/timeclock` PIN kiosk, timesheet actual vs planned with manager fixes, leave requests
  annual/sick/unpaid approved by managers; approved leave blocks slots; unpaid days deducted from salaried pay,
  worked hours on payroll). Details: CODEMAP "Service invariants". Thai copy needs native review.*
  clock + leave, embeddable booking widget (✅ X8: `public/widget.js` + `/book/embed`, CODEMAP "Online booking") · B6 restore
  drill, Instagram autopilot as a pg-boss job (✅ X8: worker `restore-drill` + `instagram-reply`, migration 0027: platform-only `platform_job_runs` + tenant `instagram_reply_queue`).
- Migrations ≥ 0017, number agreed before merge. One PR per item; CI green; owner approves merges. Shared seam: the i18n
  catalogue — Track B returns codes/keys, Track A adds the text. `packages/core/src/email.ts` (B1) is Track B's.

### 14.8 Owner requests (2026-10-08, after Phase 2) — Claude builds all of them, then B1–B6
Owner stopped the Track B partner: Claude now owns every track (§14.7 split retired). Order: finish §14.6 Phase 2
(verify + PR) → R1–R15 → B1–B6. Each item: one PR, CI green, owner approves.
- **Client phone rule (owner, 2026-10-08, locked):** client phone numbers are visible ONLY to owner, manager and
  receptionist — always; never to therapist / accountant / content editor or any custom role, no tenant toggle
  (`@spa/core` `PHONE_ROLES`; details in §14.9 "Security toggles").
- **X1–X9 integration (2026-10-08, branch x-integration):** migrations 0022 notifications · 0023 automations (tenant
  `job_runs`) · 0024 search_audit_security (pg_trgm) · 0025 waitlist_merge · 0026 equipment_timeclock · 0027 job_runs
  (platform-only `platform_job_runs` + `instagram_reply_queue`) · 0028 meta_mcp.
- **R1 Website approvals:** only super-admins approve/publish; spas can only request changes (remove spa approve).
- **R2 Bookings + pay:** "Bookings" in the sidebar (list + detail). Staff mark each booking Pending / Completed / Cancelled.
  When marking Completed the receptionist enters the therapist's commission in AED for that booking. A therapist's pay =
  the sum of these commissions only (no base, no % accrual). Receptionists (and other non-therapists): fixed salary or
  commission, chosen per person by the owner. Payroll + WPS build from this.
  *Built (W2, branch worktree-agent-a97b77d5b8dd6e500): migration 0019_booking_commissions; "% commission" for
  non-therapists = % of net POS lines credited to them (existing `commission_pct`); superseded by the owner decisions below
  (fixed AED per booking). Details: CODEMAP Service invariants (Bookings marks/commission, Payroll / pay types).*
- **R2 owner decisions (2026-10-08):** (1) receptionists on commission get a fixed AED fee set by the owner in the
  commission settings (`receptionist_booking_fee`) × the bookings they created that ended Completed in the period; no %
  option for receptionists. (2) Therapist payroll pays booking commissions only; a separate "Tips & advances" payout
  view shows Net = tips received − advances taken. (3) Consumables are never auto-restocked when a booking is
  re-opened; manual stock adjustment/restock allowed for Accountant, Manager and Receptionist. (4) Migration converts
  existing monthly subscriptions (e.g. AED 2,000/month) to the yearly price (× 12) on the 12-month plan; yearly stay.
  *Built (integration): migration 0021_payroll_owner_decisions; pay type `booking_fee`, fee set on the payroll
  page, Tips & advances payout card, permission `inventory.adjust`. Details: CODEMAP Payroll / pay types.*
- **R3 Subscription:** AED 24,000/yr = 12 monthly invoices of AED 2,000, or one-time annual; setup fee is separate
  from the plan and set per spa by the super-admin.
- **R4 Service prices optional:** a service may have no price (typed at checkout), and each service + the spa can hide
  prices on the public website.
  Built: `service_variants.price_aed` + `booking_items.price_aed` nullable (null = "Price on request"); POS lines
  for such services must have a typed price (≥ 0; client + zod + `createSale`). `services.show_price` (null = spa
  default) + `tenants.settings.hidePrices` (Settings → profile); public site, online booking and AI agents use
  `publicPrice()` (services/sites.ts) so hidden prices never leave the server. Migration 0018_optional_prices.
- **R5 Site templates:** tenant website templates rebuilt from the owner's designs (zip `1997labs-all-designs`, 20
  designs + final compilation) with their 3D scroll motion, adapted to spa content as Puck templates.
  *Built:* 15 design templates — Signature (final compilation), Noir Gold, Ivory Marble, Navy Official, Emerald
  Prestige, Platinum Minimal, Desert Night, Monogram Atelier, Obsidian Glass, Sandstone Bronze, Split Flap (I–R) and
  Aurora Glass, Blueprint, Sahara, Clay (B, C, E, H). Skipped as too tech/agency for spas: A Signal (phone demo),
  D Orbit, G Tunnel; F Bento lives inside Signature. Each keeps the design's default light/dark mode (tenant sites have
  no visitor theme switch). No agency branding, copy or numbers were carried over. Arabic copy needs native review.
- **R6 CRM width:** the spa dashboard fits the screen (no max-width cap on wide monitors); density stays.
- **R7 Meta MCP for AI:** AI agents reach Instagram / WhatsApp through a Meta MCP server. Customer WhatsApp stays
  click-to-send unless the owner explicitly lifts that lock when R7 is built (ask then).
- **R7 decision (owner, 2026-10-08):** WhatsApp stays click-to-send — the AI may read and draft WhatsApp messages
  through Meta MCP but never sends; staff tap to send. Instagram/Facebook via Meta MCP: read, draft, publish approved posts.
  *Built (X9, 2026-10-08):* first-party Meta MCP server `/api/mcp/meta` (per-tenant 5-minute token) + MCP client in
  `@spa/ai` wired into the shared tool loop with per-agent allow-lists; Instagram / Facebook Page / WhatsApp-draft tools,
  no WhatsApp send tool (also filtered from any external server); optional external server in super-admin AI settings;
  Settings → Integrations "AI tools via Meta MCP" card (groups, autopilot for public replies, Ask the AI); write tools
  audit-logged. Gap: no Facebook Page connect flow yet (Page tools appear once a Page token is stored). Details: CODEMAP "Meta MCP".
- **B1 decision (2026-10-08):** staff emails (invites, password reset, 2FA) keep sending from spamanagement.ae
  (`EMAIL_FROM`; compose default + core `DEFAULT_EMAIL_FROM` stay `.ae`, UI/app names say .co) until spamanagement.co is
  verified in Resend; then switch the env value.
- **Phone visibility (owner, 2026-10-09):** client phone numbers are shown only to owner, manager and receptionist —
  always; never to therapist, accountant, content editor or custom roles (no per-spa toggle).
- **R8 Purchases:** purchase records (materials, cleaning, supplies…) with supplier, items, totals, VAT, receipt. Built (W3):
  Services & menu → Purchases; one ledger entry per purchase (stock → 1200, rest → 6150/6160/6170/6900 by category,
  input VAT 1300); void = reversal + stock back out (CODEMAP "Stock locations + purchases").
- **R9 Warehouse stock:** central warehouse stock, transfers to branches, linked to purchases. Built (W3):
  warehouse = `branch_id NULL` stock location; transfers move quantity only (no ledger); per-location low-stock + counts.
- **R10 Exports:** every CSV export becomes Excel (.xlsx) in an official/clean format. Exception: WPS SIF keeps its
  mandated bank format. ✅ Built (X1): data exports, full export (one workbook), import templates, import-error files
  and the journal are .xlsx (title row spa + period, bold frozen header, AED/date formats, widths, one sheet per
  table); human data exports use TH headers for th viewers; import accepts .xlsx as well as CSV (CODEMAP "Spreadsheets").
- **R11 Billing page (spa):** price + the 12-month schedule, each month Paid (green dot) / Must pay (red dot). Overdue →
  one-line red bar at the top of the CRM ("Please pay your invoice to avoid …"). Status is set by the super-admin only.
- **R12 Admin console overview:** pause a spa (late payment), delete a spa, subscription one-time or monthly, setup fee
  separate, generate payment reminders.
- **R13 Login + super-admin console** use the marketing site design. ✅ `.mkt-app` scope (`components/brand-app.css`, imported by AppShell + AuthLayout): marketing tokens on `:root:has(.mkt-app)` (so portals match; light only), DM Sans / Space Grotesk, UI-kit `--ui-*` hooks (12px buttons, 18px cards), dark `.mkt-app-dark` sidebar / auth band with lime chip + active bar. `.crm` and spa sites untouched.
- **R14 Domain orders:** price shown/charged = current price + USD 10.
- **R16 AI site editing (owner, 2026-10-08):** super-admins only — in the studio editor, type an instruction ("dark
  hero", "add FAQ after services", "rewrite About in Arabic"); the AI (ModelArk via `@spa/ai` gateway) returns a change to
  the Puck draft built only from existing blocks/templates/presets; preview + undo; publishing stays a separate click.
  Spas still only request changes. Drag & drop editor stays.
  **Built (2026-10-08):** editor header "Ask AI" panel → agent `site_editor` returns typed ops (add / preset / move /
  remove / update incl. bilingual + per-device style / theme), validated against the real Puck schema, previewed on the
  canvas, Apply saves the draft (+ theme, site-wide), one-click Undo, audited, never publishes. Details: CODEMAP
  "Site builder → Ask AI".
- **R17 HTML design upload (owner, 2026-10-08):** Templates library (super-admin) → "Upload HTML": one `.html` file
  becomes a one-page studio template shown on the spa site **exactly as built** (its CSS, fonts, motion, scripts). Owner
  chose: exact page (not AI conversion), HTML only (no .md), Templates library only (not per-site upload).
  **Built (2026-10-08):** hidden Puck block `HtmlDesign` (sandboxed `srcdoc` iframe, opaque origin, full screen; root
  prop `htmlDesign` drops the site header/footer); placeholders `{{spa_name}}`, `{{book_url}}`, `{{whatsapp_url}}`,
  `{{phone}}`, `{{phone_url}}`, `{{address}}`, `{{map_url}}`, `{{site_url}}` filled live per spa; ≤ ~500 KB (fits the
  512 KB draft cap); applied/published/undone like any template; not editable in the drag & drop editor (re-upload with
  "Replace" to update). Details: CODEMAP "Site builder → HTML designs".
  **Images fix (owner bug 2026-10-09, "images cropped or shifted right"):** every design gets a zero-specificity
  responsive base sheet (`:where()`: images ≤ 100% wide, `height:auto`, `object-fit:cover`, no sideways page scroll)
  + a viewport meta; upload also fixes fixed-px image widths. "Upload HTML"/"Replace" and a per-template "Images"
  button list every image (`<img>` + CSS backgrounds) with focal point (drag/arrow keys), Fill/Fit, realign
  (left/centre/right, undoes floats/offsets) and replace (a spa's media library via MediaPicker, or an https URL);
  stored as `images` next to `html` and applied as CSS/attributes inside the sandbox only.
- **R15 Logo:** "SM" lime badge + "Spa Management" logo (`apps/web/public/brand/spamanagement-logo.svg`, 2026-10-09; replaced "Continuum" and "Handoff") in admin, marketing and
  login pages (not the spa dashboard, which shows the spa's own logo).

**R3 / R11 / R12 / R14 as built** (services `platform-billing.ts`, console tenant page + overview, spa Billing page):
- `subscriptions.price_aed` is always the **annual** price; `billing_interval` is the payment plan: `month` = 12 monthly
  invoices (price ÷ 12, cents rounding on the last), `year` = one invoice (one-time annual). Plans' interval = default.
- "Generate payment schedule" issues the current period's plan invoices (`platform_invoices.kind='plan'`,
  `period_start`, `installment`/`installments`; partial unique index → idempotent) + the setup fee as its own invoice
  (`kind='setup'`, one live per spa). Switching plan voids the other plan's unpaid invoices; refuses if any is paid.
- Paid / Must pay is set by the super-admin only ("Mark paid" records a payment for the open balance; "Mark unpaid"
  records a reversing negative payment). Stripe Checkout still settles platform invoices on its own.
- Red bar (full width above the CRM, every member): any `issued` invoice past due, or an open
  `platform_reminders` row while an invoice is unpaid. Reminders resolve when the last overdue invoice is marked paid.
- Reminder = row the spa sees (bar + Billing note) + EN message for a wa.me click-to-send link / copy (no sending).
- Pause = `tenants.status='read_only'` (PLAN §1.17: dashboard read-only, public site live); **online booking stays
  open** while paused (no rule against it); paying by card still works. Resume → `active` (`trial` while trialing).
- Delete = soft: `status='cancelled'` + `tenants.deleted_at`; members get 404, spa picker hides it, site/booking off,
  data kept; super-admin "Restore" = resume. Confirm by typing the slug.
- R14: `platform_settings.domain_markup_usd` (default 10) is added **once per order** (not per year) to the registrar
  price; search offers and `domain_orders.price_usd/price_aed` include it, `markup_usd` records it; the console
  approve prompt shows the registrar cost (price − markup).

### 14.9 X5 — B4 global search + audit viewer + Settings → Security (as built, worktree branch)
- **Search** (services `search.ts` `globalSearch(tx, q, scope, {kind,page,limit})`): clients (name; phone only with
  `clients.phone` — never matched or returned without it; local `05x` matches stored `9715x`), bookings (ref code,
  client; allowed branches; members without `calendar.manage` only their own), receipts (`sales.number`, client;
  needs `pos.use`), staff (`staff.view`), services (EN/AR name; `services.manage`). Rank: exact 3 > prefix 2 >
  substring 1 + `word_similarity`; typos via `<%` (threshold 0.5, tx-local). Indexes: pg_trgm GIN (migration 0024,
  hand-written; pg_trgm is trusted so `spa_owner` creates it; also in bootstrap.sql). UI: top-bar field + ⌘K/Ctrl+K
  palette (`components/search`, server action builds the scope), grouped, ↑↓/Enter/Esc, "Show more" per group.
- **Audit viewer**: permission `audit.view` (new; owner + manager via code). Services `audit-log.ts`
  (`listAuditLog`, `auditFilterOptions`) read `audit_log` through `withTenant` (tenant policy); actor names from the
  platform `user` table for ids in those rows only. Settings → Security card shows the last 5; `/settings/audit` =
  filters (person, action, Dubai dates) + pages; Settings tab "Audit log". Action codes shown as stored.
- **Security toggles** (`saveSecurityAction`, audited `settings.security.updated`): `tenants.settings.require2fa` —
  `requireMember` redirects owner/manager members without TOTP (fresh `user` row, not the cached session) to
  `/account?require2fa=<slug>`; super-admins exempt; can't be turned on without your own 2FA.
  **Client phones (owner decision, 2026-10-08):** visible ONLY to owner, manager and receptionist — always.
  `@spa/core` `PHONE_ROLES`; `resolvePermissions` strips `clients.phone` from every other system role and every
  custom role; the custom-role editor hides it and `saveRoleAction` rejects it (`roles.result.phoneRestricted`).
  X5's "Mask client phones for therapists" toggle + `tenants.settings.roleOverrides` were removed (integration).
  Search keeps its phone filtering (`clients.phone`).

## 15. Working agreement (token-efficient, still thorough)

- One vertical slice per PR, with a 5–10 line spec in the PR description.
- **After each edit:** typecheck + lint + unit/integration tests for the touched packages only, plus the one e2e spec covering the touched flow.
- UI edits: Playwright screenshot of the touched view at 360 / 768 / 1280 px only.
- **At each phase end only:** full Playwright suite against the ephemeral compose stack + manual walkthrough with the pilot.
- No repeated whole-app re-verification; reviews are per-PR diff.
- `CLAUDE.md` holds decisions/commands so sessions don't rediscover context; `docs/PLAN.md` is the source of truth — update it when a decision changes.

---

## 16. Open items

1. **Price details:** is AED 24,000/year VAT-inclusive, and is there a one-time setup fee?
2. **Platform company details** for Meta Business Verification and the .ae registrant (name must match company/trademark).
3. **Pilot specifics** (coming later): emirate, branches, walk-in vs booked ratio, reception device, home/hotel visits.

## 17. Fix backlog (verified 2026-10-08)

The owner decided on 2026-10-08 to keep these for now and fix them later. **Remind the owner every session** (see
CLAUDE.md). Rules for the work:
- Order: F1–F3 first, because they affect the books or let money be double-counted.
- One PR per item, with service tests plus the named e2e spec.
- Existing ledger rows are never edited; corrections are new entries.
- When an item ships, mark it ✅ here.

**F1. Refunds post to the wrong accounts.** ✅ Fixed (prorated from the sale entry; no historical corrections).
  Superseded by F2's line-level postings (each refunded line debits the accounts its sale line credited).
- Where: `packages/services/src/ledger.ts` `postRefund`, called from `sales.ts` `refundSale`.
- Problem: it always debits 4000 + 2000. Retail refunds belong in 4100. Prepaid lines (2100/2110) carried no VAT.
- Planned fix:
  - Build the refund debits from the sale's own `sale` journal entry.
  - Prorate its revenue/liability credit lines (4000/4100/2100/2110 + 2000) by refund ÷ sale total.
  - Put the rounding remainder on the largest line.
  - Leave tips (2200) out.
- Tests: services tests for retail-only, mixed and prepaid sales, checking that each account nets out correctly;
  e2e `pos.spec`, `pos-prepaid.spec`.

**F2. Refunds don't return stock, reverse COGS or reverse commissions.** ✅ Fixed (line-level refunds, migration 0015).
- Where: `packages/services/src/sales.ts` `refundSale` / `refundOptions`; `ledger.ts` `postRefund`; schema
  `refund_lines`; sale page refund sheet.
- Shipped:
  - Staff pick sale lines + quantities (max = line qty − already refunded). Each unit's amount is its share of the
    line's net paid amount (`line_total_aed`, which already carries line + sale-level discounts), in fils, with
    cumulative rounding so a full line refund adds up exactly. VAT, COGS and commission use the same shares.
  - Ledger per line, mirroring `postSale`: 4000/4100 net + 2000 VAT, 2100/2110 no VAT; credit the refund method's
    account. Retail goes back on the shelf (`returnSoldStock`, ref `refund`) and a `refund_cogs` entry
    (1200 Dr / 5000 Cr) reverses its cost; commissions get negative `commission_entries` dated the refund day plus a
    `refund_commission` entry (2300 Dr / 6010 Cr). Tips are never refunded.
  - Prepaid lines: one unit per gift card / package (linked by new `sale_line_id`; older ones match by sale and
    package definition). Only the unused value is refundable (card balance, or package remaining value, as a
    share of what was paid); the card is voided (`gift_card_txns` `refund`) or the package set `refunded`.
    Fully used ones can't be refunded.
  - The sale becomes `refunded` when nothing refundable is left. The sale row is locked during a refund.
- Tests: services `sales` (F2 block) and `ledger`; e2e `pos.spec`, `pos-prepaid.spec`.

**F3. A booking can be checked out twice.** ✅ Fixed (booking lock + `sales_booking_once`, migration 0014).
- Where: `packages/services/src/sales.ts` `createSale` (check-then-insert); schema `commerce.ts`.
- Planned fix:
  - Lock the booking row (`FOR UPDATE`) before the earlier-sale check.
  - Add a partial unique index on `sales(booking_id) WHERE booking_id IS NOT NULL AND status <> 'void'` in a new
    migration. Before adding it, check production for existing duplicates.
  - Map `23505` to a `DomainError`.
- Tests: a concurrent checkout test in services `sales`; e2e `pos.spec`.

**F4. Two bookings taking the same reference code at once surface a raw `23505`.** ✅ Fixed (insert-and-retry on `bookings_tenant_ref`, 5 attempts, then `DomainError('invalid')`).
- Where: `packages/services/src/bookings.ts` `createBooking`.
- Planned fix: catch `bookings_tenant_ref` `23505` inside the savepoint and retry with a new code, up to 5 times.
- Tests: services `bookings` test with a forced collision (mocked `newRefCode`).

**F5. Package redemption and expiry ignore the branch cutoff.** ✅ Fixed (`createSale` passes the sale's business date; otherwise the branch / default-branch `business_day_cutoff`).
- Where: `packages/services/src/loyalty.ts` lines 92 and 117 (`businessDateOf(now)`).
- Planned fix:
  - Redemption: take the sale's business date from the caller.
  - Expiry job: use the default branch's `business_day_cutoff`.
- Tests: services `p2` test with a cutoff other than 05:00.

**F6. Stock receipt and adjustment entries can't be reversed.** ✅ Fixed (`move()` returns the movement id, posted as `sourceId`; existing rows unchanged).
- Where: `packages/services/src/inventory.ts` `receiveStock`/`adjustStock`.
- Problem: their ledger entries carry no `sourceId`, so `reverseSource` can't target them.
- Planned fix: have `move()` return the inserted `stock_movements` id and post with it as `sourceId`. Existing rows
  stay as they are.
- Tests: services `p2`; e2e `inventory.spec`.

**F7. The slot filler reads tenant tables through the platform role.** ✅ Fixed (spa list via `platformDb`, per-spa reads in `withTenant`).
- Where: `apps/worker/src/jobs/tenant-jobs.ts` `runSlotFiller`.
- Planned fix: keep finding the enabled spas through `platformDb`; move the per-spa `outbox`/`branches` reads into
  `withTenant`.
- Tests: `apps/worker/test/jobs.test.ts`.

**F8. A discounted package's liability drifts.** (found during F2, verified 2026-10-08) ✅ Fixed (`issuePackage` takes the line's net share as `pricePaidAed`; existing packages unchanged).
- Where: `packages/services/src/loyalty.ts` `issuePackage` (~line 41) stores the definition's list price
  (`pricePaidAed`/`remainingValueAed = def.priceAed`), not the discounted line price actually paid.
- Effect: when a package is sold at a discount, 2110 and the per-session redemption value no longer match the money taken.
- Planned fix: pass the sale line's net price to `issuePackage`.
- Tests: services `p2` test with a discounted package sale.

**Owner decisions for F1/F2 (2026-10-08):**
- **Partial refunds are line-level:** staff pick sale lines and quantities; stock, COGS and commission are reversed
  for exactly those lines and quantities. The amount-only flow is gone.
- **Prepaid sold on the sale:** only the unused value of a gift card / package is refundable, then it is voided /
  cancelled. Refunding a used one's full price is blocked.
- **Past refunds** posted before F1 stay as they are (no correcting entries). Amount-only refunds recorded before
  F2 have no `refund_lines`; they still count against the sale total.


### Open backlog F9–F15 (owner 2026-10-09: "remind me later and always remind me" — not started; fix only when the owner says so)
Order as listed. Same reminder rule as F1–F8 (CLAUDE.md).
- ✅ **F9. Bot check on public booking** (G17): Cloudflare Turnstile on the booking page/widget + AI booking entry points; keep honeypot + per-IP limit.
  Shipped 2026-10-09: managed widget (interaction-only) on `/book`, `/book/embed` (widget), Apply (`/signup`) and
  marketing Contact; server siteverify with the visitor IP (core `verifyTurnstileToken`, web `server/turnstile.ts`),
  fail closed when `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` are set; unset = open (console Configuration row red).
  Custom spa domains opt in with `TURNSTILE_CUSTOM_DOMAINS=on` (domain must be on the widget first). No public AI
  booking endpoint exists (the DM agent runs on signed Meta webhooks / the staff test chat). Owner step:
  deploy/droplet/README.md "Bot check on public forms".
- **F10. Security headers** (G11): `script-src` CSP (nonces) + standard headers on app, console, marketing and tenant sites; sandboxed HTML designs keep their own CSP.
- ✅ **F11. Worker without the superuser password** (G10): dedicated CREATEDB-only role for the restore drill instead of `RESTORE_DRILL_ADMIN_URL`.
  Done: role `spa_drill` (bootstrap.sql; compose one-shot `db-roles` re-runs the bootstrap every deploy, so existing
  droplets get it without SSH; password derived from `SPA_OWNER_PASSWORD` unless `SPA_DRILL_PASSWORD` is set); worker
  refuses a superuser role; console Configuration row "Restore drill role (spa_drill)".
- **F12. Sitemap + Google data for spa sites** (G19): sitemap.xml/robots.txt per tenant site and marketing, schema.org JSON-LD (DaySpa/LocalBusiness), og:image.
- ✅ **F13. Booking source attribution** (G20): carry `?src=ig|gbp|qr` from web sessions into `bookings.source` so reports split Instagram/Google/QR.
  Shipped 2026-10-09 as a separate `bookings.attribution` enum (instagram, gbp, google, qr, facebook, tiktok, whatsapp,
  widget, campaign, referral, direct) so `source` stays the channel (`online`): the booking page sends t.js's tab
  entry (`spa_entry`), core `bookingAttribution` maps it. Shown as "Online · Instagram" (calendar, bookings list +
  detail), split on the dashboard Booking sources card (`kpis.byAttribution`) and console Performance detail
  (`onlineSources`). Older online bookings show "Not recorded".
- **F11. Worker without the superuser password** (G10): dedicated CREATEDB-only role for the restore drill instead of `RESTORE_DRILL_ADMIN_URL`.
- ✅ **F12. Sitemap + Google data for spa sites** (G19): sitemap.xml/robots.txt per tenant site and marketing, schema.org JSON-LD (DaySpa/LocalBusiness), og:image.
  Done 2026-10-09: every host answers its own robots.txt/sitemap.xml (proxy now rewrites them). Spa sites: canonical =
  primary active custom domain else free address; sitemap = published pages + /book with EN/AR hreflang; suspended or
  unpublished sites stay crawlable but `noindex` (no Sitemap line, empty sitemap). Pages: canonical/hreflang, og/twitter
  (hero image, else logo), DaySpa JSON-LD (branch address, hours, Maps pin/geo, Instagram, services; AED prices only
  where shown). Marketing: sitemap of the 9 pages, Organization (1997labs) + SoftwareApplication JSON-LD, generated
  og:image per page (/og/{page}.png). App/admin hosts disallow all (path routing: /app/, /admin/). CODEMAP "Search + social".
- **F13. Booking source attribution** (G20): carry `?src=ig|gbp|qr` from web sessions into `bookings.source` so reports split Instagram/Google/QR.
- **F14. Tests for 2FA + password reset** (G13 remainder): e2e for 2FA enrol/verify/require2fa redirect, password reset, files access matrix.
  ✅ Done (2026-10-09): e2e `two-factor.spec`, `password-reset.spec`, `files-access.spec`, commission reversal on refund
  in `pos.spec`; `packages/auth/test/rate-limit.test.ts` (per-IP limits, production mode). Bugs fixed on the way: a
  password reset left other sessions signed in (now `revokeSessionsOnPasswordReset` + `getSession` checks the session
  row past the cookie cache); `/files` let members of a deleted spa, and owners/managers held by "Require 2FA", read
  private files (now the same rules as `requireMember`).
- **F15. Growth extras** (nice-to-have): gift-card vouchers with QR, extra site blocks (map, video, reviews, IG feed, blog, enquiry form), automatic review/birthday/win-back message drafts (click-to-send).
- ✅ **F31. Extra KPIs** (backlog F16–F32, batch C) — shipped 2026-10-09: Reports page (`/{slug}/reports`, Finance menu;
  owner/manager/accountant via `reports.view`, RevPATH needs `dashboard.revenue`, liability `accounting.view`) with
  rebooking rate (30/60/90 days, by therapist), retention cohorts (12 months × +1…+6), RevPATH (net treatment revenue
  ex VAT ÷ therapist shift hours, time clock when no shifts; per therapist), room utilisation (per room/branch) and
  outstanding prepaid liability as of a date vs ledger 2100/2110 with any difference; branch + period picker, Excel
  export (R10 — .xlsx, not CSV); console Performance detail shows the whole-spa aggregates. Definitions: CODEMAP
  "Reports (F31)". Migration 0037 (two indexes).

### Remaining backlog F16–F32
- ✅ **F25. CI hardening.** Shipped 2026-10-09: CI job `guards` (parallel to `check`; `promote` needs both) runs the
  schema-drift check `pnpm db:check-drift` (fails when `pnpm db:generate` would write a migration), the migration-journal
  tests and `pnpm audit --prod --audit-level=high` (accepted advisories: pnpm-workspace.yaml `auditConfig.ignoreGhsas`,
  reason + review date each); `codeql.yml` (v3, security-extended; deploy-branch pushes, PRs, weekly);
  `.github/dependabot.yml` (npm + actions weekly, minor/patch grouped, stack-pin majors / 0.x minors held). Audit fix
  on the way: `@modelcontextprotocol/sdk` 1.30.1 → 1.31.0 (GHSA-6qxp-vccf-f47h, high).
- ✅ **F26. Trusted client IP (G6).** Shipped 2026-10-09: every IP read goes through `@spa/core` `clientIpFrom`
  (`Cf-Connecting-Ip` only, validated; guard test bans direct header reads), limits bucket IPv6 by /64
  (`ipRateLimitKey`, same as Better Auth, which now reads only that header). Caddy: Cloudflare ranges (verified
  current, `cloudflare-ips.sh` + weekly workflow) with strict mode, `Cf-Connecting-Ip` the only client-IP header,
  X-Real-Ip / True-Client-Ip / Do-Connecting-Ip stripped; `test-caddy-ip.sh` (CI) proves direct hits can't forge it
  and Cloudflare's value passes through. Found + fixed: deploys never applied Caddyfile edits (bind-mounted file,
  hard reset swaps the inode); `update.sh` `caddy_sync` restarts caddy when it changed.

### Remaining backlog F16–F32 — shipped on this branch
- ✅ **F27. Intake/waiver PDFs stored.** Shipped 2026-10-09: every signed intake renders a PDF server-side (pdfkit,
  embedded OFL subsets of DM Sans / Noto Sans Thai / Noto Naskh Arabic; spa logo + name, answers, consent, signature,
  submission id + record SHA-256), stored as a private file (clients.view), Download / Regenerate on the submission
  page, PDF icon on the profile, zip in Settings → Data, removed by client erase and tenant purge. Migration 0037.
- ✅ **F28. Outbox assignment.** Shipped 2026-10-09: "Assigned to" per message (active members with marketing.send),
  Mine / Unassigned / All filter, bulk assign, assignee's own sidebar badge, audit per change, optional round-robin
  auto-assign among receptionists on shift (Automations, off by default; worker every minute). Click-to-send only.

## 18. Gap audit (2026-10-09) — owner decides order; Claude owns all of it
Verified by a full plan-vs-code + production-readiness audit. Owner-only setup is in §16 / deploy/droplet/README.md.
- **Blockers:** ✅ G1 off-site backups + restore drill never run (worker reads `R2_*`, compose passes only `S3_*`; skip not alerted) ·
  ✅ G2 super-admin granted to any signup whose email is in `PLATFORM_ADMIN_EMAILS` with no email verification (provision.ts, seed.ts) ·
  ✅ G3 super-admins not forced to 2FA · ✅ G4 reminders: only staff-created bookings get one; cancel/reschedule leaves stale outbox rows; no 2 h reminder ·
  G5 ✅ /privacy, /terms, /data-deletion marketing pages (footer + login/signup links; company details placeholders in
  components/marketing/legal-config.ts — company 1997labs, Dubai, UAE (owner 2026-10-09); owner reviews text; Terms point to /pricing for fees; URLs in deploy/droplet/README.md OAuth step).
- **Important:** ✅ G6 rate limits trust spoofable `cf-connecting-ip` (no trusted_proxies / origin lock) (F26) · ✅ G7 deploy doesn't wait for CI; no pre-migrate dump / rollback ·
  ✅ G8 no worker heartbeat, uptime, disk alerts; Docker log rotation · ✅ G9 missing RESEND key prints reset links to logs (exposed in /_status/runtime.txt) ·
  ✅ G10 worker holds superuser URL (F11) · G11 no script-src CSP / security headers · G12 no tenant purge / client erase · G13 untested: 2FA, reset, impersonation, files access, commissions reversal, platform invoices ·
  G10 worker holds superuser URL · G11 no script-src CSP / security headers · G12 no tenant purge / client erase · ✅ G13 untested: 2FA, reset, impersonation, files access, commissions reversal, platform invoices (F14; invoices = billing/applications.spec) ·
  G14 therapist role view-only (no check-in/out, own commission/tips) · G15 memberships not sellable/redeemable · G16 no full tax invoice (customer name + TRN) ·
  ✅ G17 no Turnstile on public booking (F9) · ✅ G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · G19 no sitemap/robots/JSON-LD/og:image ·
  G14 therapist role view-only (no check-in/out, own commission/tips) · ✅ G15 memberships not sellable/redeemable · G16 no full tax invoice (customer name + TRN) ·
  ✅ G14 therapist role view-only (no check-in/out, own commission/tips) · G15 memberships not sellable/redeemable · G16 no full tax invoice (customer name + TRN) ·
  ✅ G17 no Turnstile on public booking (F9) · G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · G19 no sitemap/robots/JSON-LD/og:image ·
  ✅ G20 source attribution (ig/gbp/qr) not carried to bookings (F13) · ✅ G21 auto-confirm returning clients · G22 multi-branch UI (add branch, assign members) · ✅ G23 owner 2FA default off.
  G14 therapist role view-only (no check-in/out, own commission/tips) · G15 memberships not sellable/redeemable · ✅ G16 no full tax invoice (customer name + TRN) ·
  ✅ G17 no Turnstile on public booking (F9) · G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · G19 no sitemap/robots/JSON-LD/og:image ·
  ✅ G20 source attribution (ig/gbp/qr) not carried to bookings (F13) · G21 auto-confirm returning clients · ✅ G22 multi-branch UI (add branch, assign members) · G23 owner 2FA default off.
  G17 no Turnstile on public booking · ✅ G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · ✅ G19 no sitemap/robots/JSON-LD/og:image ·
  G14 therapist role view-only (no check-in/out, own commission/tips) · ✅ G15 memberships not sellable/redeemable · G16 no full tax invoice (customer name + TRN) ·
  ✅ G14 therapist role view-only (no check-in/out, own commission/tips) · G15 memberships not sellable/redeemable · G16 no full tax invoice (customer name + TRN) ·
  G17 no Turnstile on public booking · G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · ✅ G19 no sitemap/robots/JSON-LD/og:image ·
  G20 source attribution (ig/gbp/qr) not carried to bookings · ✅ G21 auto-confirm returning clients · G22 multi-branch UI (add branch, assign members) · ✅ G23 owner 2FA default off.
  G14 therapist role view-only (no check-in/out, own commission/tips) · G15 memberships not sellable/redeemable · ✅ G16 no full tax invoice (customer name + TRN) ·
  G17 no Turnstile on public booking · G18 AI spend: no per-tenant usage/budget/kill switch, owner not told at cap · ✅ G19 no sitemap/robots/JSON-LD/og:image ·
  G20 source attribution (ig/gbp/qr) not carried to bookings · G21 auto-confirm returning clients · ✅ G22 multi-branch UI (add branch, assign members) · G23 owner 2FA default off.
- **Nice-to-have:** gift-card vouchers (QR), waiver PDFs, outbox assignment, feature flags/announcements, tenant usage columns, billing auto-transitions, slug 301,
  missing site blocks (map, video, packages, reviews, IG feed, blog, enquiry form), editor autosave/lock, Studio B–E, QR poster, GBP Book button/Search Console,
  IG reels/stories, FB Page connect, Ask-AI, automatic review/birthday/rebook/win-back messages, extra KPIs, i18n of error/404 pages + `lang` attrs, ✅ CI schema-drift/audit/CodeQL (F25).

### 18.1 Owner decisions (2026-10-09)
- Order: G1–G5 first, then the access change below.
- Super-admin access stays exactly as today (impersonation, data export, fixing a spa's setup) until the owner decides otherwise.
- ✅ Add a per-spa performance view in the console: revenue totals, booking counts, marketing analytics (web visits, sources AI/IG/GBP/QR, campaigns).
  Done 2026-10-09: console `/performance` (all-spas table, sortable; 7/30/90 days, this/last month, capped 92 days)
  + `/performance/[id]` (daily/weekly revenue + bookings bars, funnel visits → started → booked, web entry sources,
  booking channels, campaigns, social posts/conversations/reviews counts, AI spend vs budget). Aggregates only.
- Spa logins (owner, manager, receptionist, therapist) keep the dashboard/CRM. On the website the spa edits **only services + prices**
  (name, description, duration, price → live site); no design approval / change requests — super-admin edits and publishes directly.
  ✅ Done 2026-10-09 (see §14.4 note): editing needs `services.manage` (owner/manager); other roles with `site.content`
  see the list read-only.
- Online booking from tenant sites stays.

### 18.2 Done (2026-10-09)
- **Two more super-admins (owner decision 2026-10-09):** `ahmedabouseif1997@gmail.com` and `sefohh.aa45@gmail.com`
  are super-admins and the **only** AI site editors; the existing production super-admin (`ahmed@arks.ae`, droplet
  base env) stays. deploy/droplet/compose.yml appends both to `${PLATFORM_ADMIN_EMAILS:-}` for web, worker and
  migrate/seed (the base env can't be edited without SSH) and defaults `SITE_AI_EDITOR_EMAILS` to exactly the two (an
  env / secrets-overlay value replaces that default). They get a login through the new admin join page and the
  console "Super-admins" card (§18.3 "Super-admin join").
- **Map links (owner request 2026-10-09):** every spa-website address (all templates, footer, placeholder site,
  booking page, uploaded HTML designs via `{{address}}`) opens Google Maps in a new tab. Optional per-branch
  "Google Maps link" (`branches.maps_url`, Settings → Business + Settings → Branches; only Google Maps URLs) pins the
  exact place; else the address is searched. Review fixes: explicit Google host allowlist (no lookalike TLDs, no /url
  redirector), the normalized `URL.href` is stored, `{{address}}` links only in real text (quote-aware tokenizer),
  and `runMigrations` stops a deploy whose journal holds a migration older than the newest applied one (merge order
  with the AI branch's 0033: the branch merging second regenerates its migration as 0034). Details: CODEMAP
  "Site builder → Map links".
- **G1:** compose passes `R2_*` to the worker; `offsiteConfig` falls back to the `S3_*` bucket (`backups/`) when no `R2_*`
  is set (separate bucket recommended); `db-backup` records ok/skipped/failed in `platform_job_runs`; console overview
  card "Off-site backup" warns when the last ok run is missing or > 36 h old.
- **G2:** `PLATFORM_ADMIN_EMAILS` promotes only verified emails (`grantListedPlatformAdmins`: provision, seed, first
  console visit); never demotes. Sign-up sends a verification email (sign-in not gated). `sendStaffEmail` throws in
  production without `RESEND_API_KEY` (no links in logs — also closes the log-leak half of G9).
- **G3:** super-admin powers (console, impersonation, studio, file access, template export) need TOTP 2FA; without it →
  account page `?admin2fa=1` to enrol (reachable on app + admin hosts; sign-out in the user menu). e2e enrols for real.
- **G7:** the droplet deploys only CI-green commits: CI job `promote` moves branch `deploy/green` (forward only,
  `GITHUB_TOKEN`, no new secret); `update.sh` deploys it (tip fallback only until it first exists), dumps
  `pre-migrate-<sha>.dump` (keep 5), migrates with lock/statement timeouts, health-checks and rolls back to
  `/opt/spa/last-good` on any failure (state `failed`, not retried without `--force`). `updater-sync` keeps the
  installed updater current. Owner steps: deploy/droplet/README.md "One-time owner steps for the CI gate".
- **G8:** worker `worker-heartbeat` every 5 min (disk, deploy state, config flags) + compose healthcheck; console
  "Server health" (red: beat > 10 min, disk > 85 %, deploy failed); one email per incident to
  `PLATFORM_ADMIN_EMAILS`; Docker log rotation (compose per service + daemon.json in cloud-init/update.sh).
- **G9:** log-leak closed by G2; console "Configuration" card (green/red per production setting, no values,
  RESEND first with its source). Owner add-on (2026-10-09): console Settings → Email (Resend key write-only, last 4
  shown; From; "Send test email to me"); DB value wins over env in web + worker; key AES-GCM when an encryption key
  exists, else stored as entered (owner: never refuse to save); never logged/audited.
- **G12 (data deletion, backs the /data-deletion "within 30 days" promise):** services `data-deletion.ts`.
  - **Tenant purge:** console spa page → "Permanently delete" (only once soft-deleted; type the slug; "Download full
    export" link next to it and next to Delete). `purgeTenant` (platform role): Cloudflare custom hostnames →
    one transaction (row counts of every `tenant_id` table from the catalog, pg-boss jobs whose `data.tenantId`
    matches — none today, best effort/privilege-checked — `DELETE tenants` → every tenant FK cascades) → bucket
    objects under `<tenantId>/`. **Ledger exception (decision):** the ledger is append-only for live spas (triggers
    block `spa_app` only); purging a whole deleted spa as the platform role is the one allowed deletion of journal rows
    / booking commissions. Record: `tenant_purges` (no FK; slug, name, who, mode, counts, objects deleted, clean-up
    errors) + a tenant-less `platform.tenant.purged` audit row; the spa's own audit rows go with it. Login accounts
    (`user`) stay — they may belong to other spas. Integration tokens are rows (deleted), not revoked at Meta/Google.
  - **Auto-purge (default off):** console Settings → Data retention "Auto-purge deleted spas after (days)"
    (`platform_settings.auto_purge_days`, blank = off, ≥ 30 so the export window stays). Worker `tenant-auto-purge`
    04:30 daily; skipped/ok/failed in `platform_job_runs`.
  - **Client erase:** client profile → "Erase personal data" card (owner, or super-admin acting on the spa;
    `clients.manage` + roleKey owner; tick-box confirm; export link). `eraseClient(tx)` keeps the client row as
    "Erased client" (`clients.erased_at`; UI shows the translated label) with sales, ledger, bookings, packages,
    memberships, gift cards; removes phone/email/birthday/nationality/gender/tags/preferences/notes/blocklist,
    treatment notes, intake submissions (answers + signatures), outbox rows, conversations (+ messages), waitlist
    entries and booking notes; sets marketing opt-out. Audit `client.erased` (counts only). No files link to
    clients today. Not scrubbed: names inside old audit-log `data` and notification payloads.
- **G18:** console **AI usage** (`/ai/usage`, nav + links from AI models / Performance / overview card "AI budgets"):
  every spa this + last month (calls, tokens, cost, % of budget; sortable), inline monthly budget edit, per-spa AI
  on/off (`tenants.ai_enabled`) and a platform-wide switch (`platform_settings.ai_enabled`); `/ai/usage/[id]` = daily
  cost + by agent + by model for this/last month. All changes audited (`platform.ai.*`). Shared aggregation
  `services/ai-usage.ts` (also Performance + dashboard meter). Gateway (`assertAiAllowed`): kill switches →
  `AiPausedError` (extends `AiDisabledError`); budget → `AiBudgetExceededError`; after metering, 80 % / 100 % bell
  notifications (`ai.budget_warning` / `ai.budget_reached`, `billing.view`, dedupe `ai.budget.<80|100>.<YYYY-MM>` =
  once per threshold per Dubai month). Dashboard: one AI banner (80 % warning / "AI paused: monthly AI budget
  reached — contact us" / AI off), budget error messages EN + TH. Months reset at Asia/Dubai month start.
- **G15:** memberships sold/renewed in POS (sale line kind `membership`, one one-month period per line, client
  required; selling a plan the client still holds = renewal starting the day after the current period). Price →
  2110 with no VAT at sale (like packages); included sessions move their share to revenue + VAT when used; whatever
  is left when the period ends is recognised then (`membership_expiry`, 2110 → 4000 + VAT — earned, not breakage).
  Checkout: member discount % auto-applies to treatments (untick per line), "use an included session" checkbox;
  both show on the receipt as typed suffixes. Daily job `memberships-renew` (automation switch `membershipRenewals`):
  ≤ 7 days before the end → status `due` + WhatsApp renewal reminder queued in /messages (click-to-send; opted-out /
  blocklisted clients skipped), ended → `expired`. Refund = unused value (as packages), period `refunded`; sales with
  a membership or a membership session can't be voided. Discounts already given aren't clawed back on refund.
  Client profile lists memberships.
- **G14:** new permission `calendar.ownStatus` (therapist system role; system roles resolve from code, so every
  existing spa has it — no migration). Calendar booking sheet shows Check in / Start service / Complete on bookings
  the member's linked staff profile is on (`setOwnStatusAction` → services `setOwnBookingStatus`: ownership + from
  confirmed/checked-in/in-service only; never confirm, cancel, re-open or move). Completing records no commission —
  the front desk enters it on the booking page as before. Therapist home has "My earnings" (today / Mon-start week /
  month to date): own `booking_commissions` (booking business date, net of corrections) + own tips on paid sales
  (`staffEarnings`); no spa revenue.
- **G21:** Settings → profile → "Online booking" card: "Auto-confirm returning clients" (off) + "after N completed
  visits" (1–50, default 1) → `tenants.settings.onlineBooking`. `selfBookingStatus` (services) is used by `bookOnline`
  (website/widget) and the AI DM `book` tool (Instagram/WhatsApp AI): a client matched by phone with ≥ N completed
  bookings is created `confirmed` (reservations unchanged, EXCLUDE), so `createBooking` plans the confirmation +
  reminders. The public done page then says "Booking confirmed".
- **G23:** "Require 2FA for owner & managers" is on by default: `requires2fa(settings)` (core) treats missing as on,
  provisioning writes `require2fa: true`, migration `0030_require_2fa_default` sets it on for every existing spa (even
  ones that had turned it off). Owners may still turn it off (Settings → Security). Super-admin impersonation is
  unaffected (not a member → own G3 2FA rule). e2e: `signUpOwner` stores a verified TOTP secret (`enableTotp`) after
  sign-up lands on `/account?require2fa=`; onboarding.spec enrols through the UI.
- **G16 (full tax invoice):** receipt → "Full tax invoice" (`sales/[id]/invoice`): "Tax Invoice / فاتورة ضريبية", supplier
  legal name + branch address + TRN, customer billing name/address/TRN (`sales.billing`, prefilled from
  `clients.billing`; "also save on the client's profile" needs `clients.manage`), invoice no. = sale number (gapless
  per-tenant counter), issue date (sale created) + supply date (business date), per line qty / unit price incl. VAT /
  discount (line + share of sale discount) / taxable / VAT % / VAT, totals + amount payable in AED; EN with AR labels,
  A4 print CSS. Prepaid lines (packages, gift cards) show 0 % (VAT at redemption). `taxInvoiceLines` /
  `saveSaleBilling` in services/tax-invoice.ts. Credit notes for refunds are not separate documents (listed on it).
- **G22 (multi-branch):** Settings → Branches (`settings.manage`): add / edit (name, address, phone, WhatsApp, cutoff;
  time zone fixed Asia/Dubai) / archive / restore; new branches copy the main branch's hours; main branch can't be
  archived; plan `limits.branches` enforced on add/restore when the plan sets it. Team: per-member "All branches" or
  ticked branches (edit + invite; invites now really create `member_branches` on accept). Pickers: calendar, POS,
  bookings already had them; added on the overview (KPIs, "All branches" for unrestricted members) and the public
  booking page (`?branch=`, select when > 1 open branch; slots + booking use it). Archived branches drop out of
  pickers, rooms/hours screens and online booking. Services in services/branches.ts.

### 18.3 Spa applications (owner decision 2026-10-09)
New spas **apply**; the platform owner accepts or rejects. Self-serve instant sign-up (trial) is gone.
- **Apply** (app host `/signup`, marketing CTAs "Apply for your spa" / "Get started"): name, work email, password (the
  login is created now), UAE mobile (required, stored E.164 `+9715…`), spa name, web address (live check: format,
  existing spa, **or held by another pending application**), emirate (7) + street address, optional logo (processed
  512 px WebP, kept on the application), plan (active plans with yearly price + setup fee), preferred start (≥ today,
  Dubai), notes. No trade licence / TRN / size. Terms/Privacy links stay. A signed-in login with no spa and no
  application (e.g. OAuth later, or an existing owner adding a spa) gets the same form without the login fields.
  One pending application per login (partial unique index); a pending application holds its slug (partial unique).
- **Before approval** the login is **locked**: with no spa it only sees `/application` (EN + TH, auth layout: status +
  everything sent, sign-out). **No 2FA** to apply or to see it; the G23 owner/manager 2FA rule (default on, unchanged)
  applies once they open the dashboard. Dashboard index / account page send it to `/application`.
- **Owner notified:** email to `PLATFORM_ADMIN_EMAILS` (`sendStaffEmail`, never fails the submission), console nav
  "Applications" with a pending-count badge, overview card "Spa applications".
- **Console `/applications`** (super-admin; `requirePlatformAdmin` in pages and actions): status filter (pending first,
  oldest first), detail = every field + logo + live slug check. **Reject**: optional reason + "Show reason to
  applicant" → login **disabled** (`user.disabled_at`) and its sessions deleted — unless the login is also an active
  member of another spa or a super-admin (then only the application closes). **Accept**: plan + start date (prefilled)
  + setup payment when the plan's fee > 0: Charge VAT (default on), Paid in full / Deposit (amount > 0 and < the
  setup-fee invoice total, incl. VAT only when charged; balance due on the start date or 10 days after), payment date
  (≤ today), cash / bank transfer / credit card (`card`), optional reference + note.
- **Accept = one platform transaction** (`acceptApplication`, services/applications.ts): `provisionTenantTx` (tenant
  **active**, default branch with "street, Emirate" + mobile, system roles, owner membership, `require2fa: true`), the
  subscription **active** from the start date for one year (`current_period_end` = start + 12 months, plan price/fee/
  interval), the setup-fee platform invoice via `createPlatformInvoice` (numbering, VAT optional; validated before numbering;
  due = start date or 10 days after it — see "Owner answers" below), the payment via `recordPlatformPayment` (shared with console "Record a payment") → full =
  paid, deposit = issued with a balance due; logo → `setTenantLogo`. Plan invoices are issued at acceptance too
  (same code as "Generate payment schedule"). The rest of a deposit is recorded later with Record a payment. Payments are recorded, never processed.
- **Balance due** shows on the console spa page (Paid / Balance columns, "part paid" = net received > 0, header
  "Due now" (due date ≤ today) + "Outstanding" (all open, incl. later installments)) and the spa's Billing page
  ("Paid AED x · balance due AED y", pill "Balance due"); Pay-by-card is hidden on a partly paid invoice and refused by
  the action too (`cardPayableInvoice`: Stripe charges a whole invoice); a Checkout paid after another payment is still
  recorded but its payment note says "OVERPAID by AED x: refund or credit it".
- **Disabled logins:** Better Auth `databaseHooks.session.create.before` refuses a session (`ACCOUNT_DISABLED`, + the
  reason when shared) → the sign-in page shows "Application not approved" (+ reason); web `getSession` reads
  `user.disabled_at` fresh, so a cached cookie session stops at once. Emails: accepted (sign-in link, 2FA note),
  rejected (reason only if shared). Audit: `platform.application.submitted` / `accepted` (plan, start, setup payment
  summary) / `rejected` (reason, share flag, login disabled, sessions revoked).
- **Data:** `spa_applications` (platform-only RLS; `created_tenant_id`, never `tenant_id`; `setup_payment` jsonb
  summary; logo bytes) + `user.disabled_at`. No console "create spa" existed; existing spas are unaffected.
- **e2e:** `signUpOwner` = `applyForSpa` (UI) + `approveApplication` (services fast path); `applications.spec` covers
  apply → waiting page → console accept with a deposit by bank transfer → sign-in → 2FA enrol → dashboard + billing
  balance, and the reject path. `signInPlatformAdmin` creates its login through the auth API (no spa).
- **Review fixes (2026-10-09):** apply is limited per IP (5/hour, 20/day; Postgres `rate_limits`, `hitRateLimit` +
  web `withinIpLimit`; production only, off with `AUTH_RATE_LIMIT=off` like Better Auth's limiter) because the
  action creates the login server-side, past Better Auth's HTTP limiter. `createPlatformInvoice` checks for an existing
  setup / same plan installment before drawing a number (no gaps when "Generate payment schedule" runs after an
  accept); `recordPlatformPayment` takes `today` (reminders resolve only when nothing is overdue today). Rejection
  email says "account closed" only when the login was disabled. Pricing cards link `/signup?plan=<id>` (preselected);
  "another spa" copy only for a login that has a spa; the waiting page shows the full web address; phones show the
  Applications count on the bottom tab. e2e: a signed-in owner on the console gets 404 for `/applications(/id)` and
  the super-admin's captured accept/reject calls replayed with the owner's session change nothing.
- **Super-admin join (owner, 2026-10-09):** the public sign-up is the application form, so `PLATFORM_ADMIN_EMAILS`
  addresses create their login on the admin host **`/join`** (linked "Create a super-admin account" from the admin
  sign-in page only): name, email, password → Better Auth sign-up (no spa, no application) + verification email
  (callback = console). Unlisted email → neutral "This email address cannot create a super-admin account." (per-IP
  limit 5/h, 20/day counted before the check). Signed in but not verified → `/join` shows how to finish (+ "Send the
  link again"), and the console redirects there instead of a 404. Verified → console → promoted (G2) → 2FA enrolment
  (G3) → console. The application form refuses a listed email before creating anything ("…create its login on the
  admin join page instead: <url>/join"; `submitApplication` refuses it too). Listed / super-admin logins are never
  "locked" applicants: dashboard home, `/application` and `/signup` send them (no spa) to the console, so 2FA
  enrolment is always reachable. **Bootstrap without email:** console Company → **Super-admins** card lists
  super-admins (email, verified, 2FA, still listed) and listed emails that aren't yet (no login / not verified /
  verified → promoted on first visit / login closed); a super-admin **with 2FA** can "Mark email verified" (or "Make
  super-admin now") for a registered, not-disabled listed login only → promoted at once (it still enrols 2FA).
  Audited: `platform.admin.joined`, `platform.admin.verification_resent`, `platform.admin.email_verified`. No
  removal/demotion anywhere (and never on yourself). `listedAdminEmails` drops empty segments + duplicates and also
  splits on spaces/semicolons. e2e `admin-join.spec` (confirm path, link path + app-home redirect, refusals).
  Also fixed: the admin sign-in's "Forgot password?" pointed at the admin host (404; its link prefetch never
  completed, which stalled `networkidle` in site-mcp.spec once a second link was on the page) → now the app host's
  reset page (`LoginForm forgotHref`).
- Not built (later if wanted): re-opening a disabled login from the console, editing an application, Google sign-in,
  holding the slug / notifying only after email verification, expiring unverified pending applications.
- **Prompt site editing (owner, 2026-10-09):** two ways to edit a spa's site with prompts, both editing the DRAFT
  only (never publish), both limited to `SITE_AI_EDITOR_EMAILS` (comma-separated, verified email, must also be a
  super-admin with 2FA; empty = nobody; re-checked on every action/request, never hard-coded).
  - **A — ops layer** `@spa/services` `site-edit.ts`: `runSiteEdit` (update / add (index, after/before, into slot) /
    preset / move / remove block, theme, add_page, rename_page, html_design; zod shapes + `applySiteEditOps` against
    the Puck block schema; all-or-nothing; `dryRun` returns the resulting drafts; saves via `saveDraft` / `addPage` /
    `renamePage` / `updateDraftTheme`), `restoreSiteEdit` (undo), `getSiteForEdit`, `blockCatalogue`,
    `siteEditAuditData` (callers audit). **Decision:** theme + renames are now draftable: `sites.theme_draft` (editor
    and previews show it; `publishPage` makes it live) and `site_pages.pending` (rename of a live page, applied by its
    next publish). The Theme panel stays live and also updates a pending draft theme.
  - **B — Studio "Ask AI to edit"** (R16 panel): plan (`site_editor` agent, any instruction language) → dry run →
    canvas preview → Apply (same ops through A) → history of the last 5 with Undo. Theme ops go to the draft theme.
  - **C — Claude connector** `/api/mcp` (remote MCP, Streamable HTTP, `@modelcontextprotocol/sdk` 1.30.1): OAuth 2.1 =
    Better Auth `@better-auth/mcp` 1.7.7 (+ jwt plugin): DCR, PKCE, RFC 9728/8414 metadata under `/.well-known`,
    sign-in + 2FA + consent (`/oauth/consent`) on the app host. Tools: list_spas, get_site, list_block_types,
    update_block, add_block, remove_block, move_block, set_theme, add_page, rename_page, replace_html_design,
    preview_link — no publish tool. Per call: token → allow-list → live consent → 60 calls/min per token; audit
    `site.mcp.<tool>` "via Claude (MCP)". Console → Websites "Connect Claude" card: URL + copy, connected clients,
    Revoke (deletes consent + tokens → next call 401). Owner setup: deploy/droplet/README.md "Connect Claude".
  - **Review fixes (2026-10-09):** OAuth — clients may only register Claude's callbacks (`mcpRedirectUris()`:
    claude.ai / claude.com `…/api/mcp/auth_callback`, env `MCP_REDIRECT_URIS` replaces; loopback only while APP_URL is
    http); `validateRedirectUri` holds every authorize to the same list (no consent phishing, no open redirect, legacy
    rows included); client admin endpoints disabled, `clientPrivileges` = listed editor; consent page shows the
    redirect host (no "Claude" fallback name); grants audited `platform.mcp.client_authorized`; worker
    `oauth-clients-prune` (hourly) drops clients without consent after 24 h; Caddy trusts Cf-Connecting-Ip /
    X-Forwarded-For only from Cloudflare ranges and overwrites Cf-Connecting-Ip (forged-IP rate-limit bypass).
    Drafts — **decisions:** the Theme panel shows the LIVE theme and saves only changed fields (live + into a draft
    theme); every draft writer takes `lockSite` (row lock on `sites`); the Studio editor sends an `EditStamp` (page
    version + draft theme/rename hash) with save / publish / Ask AI apply / undo and is refused ("changed elsewhere —
    reload") when stale; editor publish = one transaction and its dialog lists what also goes live (+ contrast of
    other live pages under the draft theme); "Publish site" and the overview count/publish theme-only and rename-only
    changes (`publishAll` → `{ pages, theme }`); pending rename slugs are reserved (`takenSlugs`) and re-checked at
    publish (DomainError); renames validated in dry runs (`checkPageRename`); undo restores the exact earlier state
    (`SiteEditPrevious`: raw draft theme incl. none, added draft row dropped).

- **Owner answers (2026-10-09, after launch review):** VAT on the setup invoice is optional (chosen at acceptance);
  deposit must be > 0 and < the setup invoice total (incl. VAT only when VAT is charged); the balance is due on the
  start/delivery date or 10 days after start (chosen at acceptance, default 10 days); subscription fees (monthly AED 2,000
  or yearly AED 24,000 per the plan) start from the start date; rejected-login rule and apply-form limits (5/h, 20/day per IP) agreed.
  Thai + Arabic copy natively reviewed by the owner's team (2026-10-09). Features page: built "Coming next" items move to the main list.
  **Implemented (2026-10-09):** Accept dialog: "Charge VAT (5%)" checkbox on the setup invoice (default on = the
  platform's VAT rate, as every platform invoice; hidden when the rate is 0; plan invoices keep VAT per the settings);
  no-VAT invoice = subtotal = total, VAT 0 (console Total shows "· no VAT"; spa Billing shows totals only). Deposit:
  > 0 and < the invoice total, one wording `depositRule` (dialog hint = service error, catalogue `domain.depositRange`
  / `depositRangeNoVat`). Deposit → "Balance due: On the start / delivery date | 10 days after start" (default 10
  days; date shown; never before today; full payment uses the default). Acceptance then issues the plan's invoices
  from the start date with the existing schedule code (`generateBillingScheduleTx`): **all of them at once** like the
  button (12 monthly × AED 2,000 + VAT due monthly from the start, or one yearly invoice due on it) — "Generate payment
  schedule" afterwards = "already up to date", no numbers drawn. The logo step now runs before any invoice is numbered
  (a failing accept leaves no number gap). Summary (`setup_payment` jsonb) gains `vat` + `dueDate`; audit
  `platform.application.accepted` gains `planInvoices`. Features page: waitlist, equipment, booking widget →
  "Bookings"; time clock + leave, client merge → "Control without the admin"; "Coming next" = Reserve with Google
  only (P4 partner integration, not built).

### 18.5 Marketing: Spa CRM page (owner 2026-10-09)
- Owner request: the marketing site sells the spa CRM (the dashboard we build and run for each spa), not only websites,
  and says it is in English **and Thai**. New page `/crm` (`app/marketing/crm/page.tsx`, metadata + OG): hero (CTAs
  "Apply for your spa" → app `/signup` via `requestUrls`, "See pricing"), "In English or ภาษาไทย" EN/TH toggle demo, 12
  modules (each verified against §14.6–§18: calendar & rooms/EXCLUDE, all channels on one calendar, POS with packages,
  gift cards, memberships (G15), full tax invoice (G16), staff/commission (payroll + WPS; tips + advances paid out separately, R2), therapist own day + earnings
  (G14), WhatsApp click-to-send, clients + intake forms, reports/KPIs, multi-branch (G22), roles + audit log, 2FA on by
  default (G23)), "Set up for you" (apply → we build menu/rooms/staff/hours with you → first import → team invites;
  matches the Contact copy), closing CtaBand.
- **Demo rule:** the mock's labels are the dashboard's real catalogue strings (`@spa/core/i18n`, resolved on the server in
  `components/marketing/crm-demo-copy.ts`; the client gets only those strings) — never hand-typed Thai. Typed names
  (clients, therapists, treatments, products) stay untranslated and are dotted-underlined; "Walk-in" is a label, so it
  translates. Swap animation is CSS and off under `prefers-reduced-motion`. Marketing copy itself is English; it does
  not claim the Thai is native-reviewed (it still needs that review, §14.6).
- Home: new "Spa CRM" section (EN/TH label pairs from the catalogues, link to /crm; since replaced by the §18.8
  showcase); hero notes now "Sites in English &
  Arabic · Dashboard in English & Thai". Features: "Your team's language" band (link to /crm) + team-area bullet.
  FAQ "Is it in Arabic?" no longer says the dashboard is English-only. Thai font: the marketing layout loads
  `@fontsource-variable/noto-sans-thai`; it sits after DM Sans/Space Grotesk in `--font`/`--head`, so it supplies Thai
  glyphs only (typed Latin names keep their face in EN and TH; only the Thai subset loads), as in crm.css.
- **Pending (shell.tsx is being rebuilt on another branch):** add `| 'crm'` to `MarketingPage`, NAV entry
  `{ key: 'crm', href: '/crm', label: 'Spa CRM' }` before 'Website studio', footer Product column `NAV.slice(0, 4)`
  (else Pricing drops out), then `/crm` uses `active="crm"` (today `active="home"`, so no nav item is marked).
  /crm is listed in the marketing sitemap (F12, `MARKETING_PAGES` in components/marketing/seo.ts).
- e2e: `marketing-crm.spec` (page, CTAs, toggle → Thai catalogue strings, typed names stay, home/features links);
  `platform-domains.spec` also checks /crm links on the second domain.

### 18.4 Contact enquiries (owner 2026-10-09)
Marketing **Contact** page (`marketing/contact`) gets an enquiry form; the owner works enquiries in the console.
- **Form** (English only, like all marketing): your name, phone (UAE mobile 05…/5…/9715… or international with + / 00,
  `toE164` in core whatsapp.ts → stored `+…`; UAE landlines with the trunk 0 too), email (lowercased), spa name, "What
  do you need?" (required, ≤ 2000 chars, live counter) — all required. Server-side zod (`enquirySchema`, services
  enquiries.ts; the service re-parses, never stores invalid input); errors inline per field (`aria-invalid` +
  `aria-describedby`) + a summary line; typed values stay on error (transition submit, not `action=`); success panel
  "Thanks — we'll reply within one working day." (focused). 360 px safe; styles `.mkt-enq*` / `.mkt-input` in marketing.css.
- **Spam:** honeypot `extra_details` (off-screen, `aria-hidden`, no tab stop) → answered like a success, nothing stored /
  counted / sent; then per-IP limit **5/hour, 20/day** (`ENQUIRY_LIMITS`, web `withinIpLimit('enquiry', …)` → services
  `withinRateLimits` over `rate_limits`; production only, `AUTH_RATE_LIMIT=off` like apply) — counted after validation
  so fixing typos doesn't use the quota; refused → "email us at <contact email>".
- **Stored:** `contact_enquiries` (platform-only RLS, no `tenant_id`): name, phone, email, spa_name, message, status
  `new | contacted | closed`, admin_note, ip_hash (HMAC-SHA256 of the IP with BETTER_AUTH_SECRET, 32 hex — the raw IP is
  only in the day-long rate-limit keys), user_agent (≤ 300), handled_by/at, timestamps. Audit
  `platform.enquiry.received` (no actor, **`ip: null`** — `audit()` takes an `ip` override, so the raw address is not
  stored next to the enquiry) and `platform.enquiry.updated` (changed, status from→to, note). Name / spa name are one
  line (line breaks, control chars → space, bidi overrides dropped: they go into the email Subject and logs); the
  message keeps newlines/tabs only (NUL etc. dropped). Phones: `toE164` drops a trunk 0 — `(0)`, after +971, and
  after a separately typed country code (+44 07700…, 0049 030…) except countries that keep it (+39 Italy, …).
- **Notify:** after the reply (`after()`), `sendStaffEmail` to every `PLATFORM_ADMIN_EMAILS` address with
  **reply-to = the sender** (`StaffEmail.replyTo` → Resend `reply_to`) + console link; failures are logged, never
  fail the submission. Console nav **Enquiries** (after Applications) with the count of `new` (`newEnquiryCount`).
- **Console `/enquiries`** (`requirePlatformAdmin` in pages + action): newest first, filter New / Contacted / Closed /
  All (default All, with counts), search name / email / spa (and phone digits, 4+; the local 05… / 00971… forms match
  the stored +971…). Empty filter → "No <status> enquiries" ("No enquiries yet" only under All). Detail page: message, all fields,
  **Call** (`tel:`), **WhatsApp** (`wa.me` click-to-send draft, locked comms rule), **Email** (`mailto:` with subject),
  last handled (who/when); Follow-up form = status radio + internal note (≤ 2000) → `updateEnquiry` (row-locked, stamps
  handled_by/at only when something changed; "No changes" otherwise). No "convert to application" (not needed).
- **Contact email:** the page shows the console's company email when set, else `PLATFORM_CONTACT_EMAIL` =
  **ask@spamanagement.co** (core email.ts; replaces the old hello@ fallback); the seed sets it for new installs.
  **Owner:** if Console → Company → Email holds another address, change it there to ask@spamanagement.co. Make sure
  ask@spamanagement.co receives mail (mailbox/forwarding at the domain's email provider).
- **Tests:** core `toE164` + Resend `reply_to`; services `enquiries.test.ts` (store/normalise, one-line fields,
  validation, 5/hour limit, list/search incl. local UAE phone/counts, status + note, spa role can't read/write); e2e
  `enquiries.spec.ts` (360 px, inline error keeps values → sent → super-admin badge + search + links → contacted + note,
  badge drops, audit, empty Closed filter; honeypot dropped; console needs sign-in; with a console Resend key the
  admin email lands in the e2e outbox with reply-to = sender + console link, received audit row has no IP).
### 18.7 Marketing footer (owner 2026-10-09)
Rich SaaS footer (`components/marketing/shell.tsx` `Footer`, `.mkt-foot/.mkt-fgrid/.mkt-fnav/.mkt-fhead/.mkt-fbot`):
brand block (logo, "Calm software for busy spas.", one-line product summary) + `nav "Footer"` with five columns —
Product (Features, Website studio, Pricing, Apply for your spa, Sign in), Features (`/features#bookings|follow-up|money|
marketing|team|automations`), Website studio (`/website-builder#make-it-yours|how-we-build-it|section-designs|
after-launch|included`), Built for the UAE (`/pricing#plans`, VAT + WhatsApp → features anchors, English & Arabic →
`#included`, `/pricing#faq`), Company (Contact, the contact-page email (super-admin Settings, fallback
`DEFAULT_CONTACT_EMAIL` = ask@spamanagement.co), Privacy, Terms, Data deletion) — then "© year {LEGAL.companyName} ·
{LEGAL.brand}" only (the payments/WhatsApp disclaimer line was removed at the owner's request, 2026-10-09). Only existing pages/sections are linked
(no multi-branch section exists, so none); section `id`s are stable link targets. Layout: brand + 5 cols ≥ 1100 px,
brand on top + 3 cols tablet, 2 cols ≤ 640 px. platform-domains.spec checks the headings, the mailto address
(Settings email or the default), that every footer link answers 200 and that every `#anchor` exists.
### 18.6 Spa CRM look + PWA (owner 2026-10-09)
- **Look ✅ (branch feat/crm-brand-theme)** — replaces the blue Be Relax colours (§14.6 layout/density unchanged):
  the sign-in brand (`components/brand-app.css`) made lighter, every spa's CRM identical. Tokens only, in
  `app/dashboard/[tenant]/crm.css` `:root:has(.crm)`: fonts `--crm-font` (DM Sans) / `--crm-head` (Space Grotesk:
  h1–h3, top-bar title, spa name) / `--crm-num` (Space Grotesk for KPI/stat figures in both languages); Thai puts
  Noto Sans Thai Variable first in `--crm-font` + `--crm-head` (no tofu, Thai headings in Noto). Colours: frame
  `--crm-bg` #E7EFE6 mint, page `--crm-page` #F8FAF5, sidebar `--crm-side-bg` #F5F8F1, cards white, primary
  `--crm-accent` #0F6B4B (ink #0A4F37), lime `--crm-lime` #D9F26A only for the active menu item (lime wash + green
  start bar), nav count badges, `acc` pills (`--crm-lime-soft`) and the keyboard focus halo (green 2 px ring + lime
  inside). Semantic colours darkened to pass AA on their tints: ok #13773F, warn #8A5A00, bad #B93B1B, info teal
  #1B6684. Avatars and chart palette re-picked (white initials AA; chart: green, mint, blue, amber, orange, violet,
  magenta `--crm-magenta` #B03F78 — no second green, 7 booking sources). WCAG AA: text pairs ≥ 4.5:1; form-control
  edges `--crm-ctl-line` #848E88 ≥ 3:1 (1.4.11, kit Input/Select/Textarea via `--ui-ctl-border`, `.crm-inp`); card
  dividers `--crm-line` stay soft (decorative). The html element takes `--crm-font` too (`font-sans` unused in the CRM).
- **Platform badge ✅** — `Logo` (components/brand.tsx, 28 px tall) at the sidebar foot under the plan card (also in
  the phone drawer), links to `canonicalUrls().marketing()` in a new tab (`rel=noopener`, aria-label "Spa
  Management", brand name not translated). The whole sidebar (and phone drawer) scrolls as one at every height — the
  menu never scrolls inside its own box; the foot sits at the bottom when everything fits (`margin-top:auto`) and
  after the menu when it doesn't, so it never covers a menu item (shell e2e checks it). Badge 24 px on ≤700 px tall
  screens. Not on the no-spa/locked pages.
- **Open owner question (2026-10-09):** "same theme as the log in like fonts sizeing" — the CRM has the sign-in font
  families + colours but keeps the compact type scale (titles 18–20 px, 13 px body, 34 px buttons) vs sign-in
  (28–36 px titles, 15 px body, 44 px controls, 700 headings). Raise the CRM type tokens only if the owner says so;
  record the answer here.
- **PWA** — separate branch (manifest, icons = spa logo + "<first word> Management", service worker, install item
  in the user menu).
### 18.6 Spa CRM look + PWA (owner 2026-10-09)
Owner decisions — **replace** the 2026-10-08 "Be Relax CRM design (blue)" look; the CRM layout/screens stay:
- **Look:** the spa dashboard uses the login's brand theme (same fonts and sizing, colours lighter); the platform's
  logo sits small in a premium spot of every spa's CRM without affecting the CRM UX (separate branch: crm.css tokens,
  fonts, sidebar badge).
- ✅ **Installable app for every spa's CRM** (done 2026-10-09, branch feat/spa-pwa):
  - Manifest `{dashboard}/app.webmanifest` (host routing `app.…/{slug}/app.webmanifest`, path routing
    `/app/{slug}/app.webmanifest`): `name` = `short_name` = first word of the spa name + " Management" (core
    `pwaAppName`: edge punctuation, possessive "'s" and a leading article — the/a/an/al/el/le/la — dropped; Arabic/Thai
    words kept as typed; empty → "Spa Management"); `id` = `start_url` = `scope` = the dashboard path (`/{slug}`), so
    each spa installs separately (scope is a path prefix: `/tamara` also covers a `/tamara-x` slug — harmless);
    standalone, theme `#0f6b4b` (dark green), background `#f6f6f9`, `lang` en, `dir` ltr (auto for Arabic names).
  - Icons `{dashboard}/app-icon/{key}/{192|512|maskable-512|apple-180}` (PNG): logo trimmed + centred on a white
    tile (any = rounded, maskable = full bleed inside the safe zone, apple = full bleed); no logo → initials (first
    letters of the first two words; non-Latin names use the slug's) in ink `#0b0b0f` on lime `#d9f26a`. Key = hash of
    `ICON_VERSION` + logo file id (or initials) → `immutable` 1-year cache; a new logo = new URLs; old keys get the
    current icon for 5 min. Public, cookie-free, only the logo-derived image; rendered once per key (in-memory LRU,
    shared in-flight renders, 30 s slug cache + separate miss cache) — no DB rate-limiter writes. An unknown key
    re-reads the spa at most once per 10 s per slug. A logo that can't be read right now (storage error, bad file)
    gets the initials with `no-store` and no ETag (kept in memory 60 s only), so installs never keep a stand-in.
  - `<head>` of `dashboard/[tenant]` only: manifest link, apple-touch-icon, apple-mobile-web-app-title/capable,
    theme-color. Console and marketing keep the root `/manifest.webmanifest`.
  - Service worker `public/sw.js` (one registration, scope `/`, same URL as push → no second worker; registered on
    every dashboard load by `components/pwa` `PwaSetup`): every GET page load in scope is answered with its
    navigation-preload response (one server request each — marketing, console, sites and OAuth callbacks included);
    offline → dashboard loads only get the page's localised offline page ("You're offline — reconnect to continue",
    EN/TH via `pwa.*` keys, built-in bilingual copy as fallback). Nothing else is cached; API, server actions,
    POSTs, RSC fetches and files pass through untouched. Notification clicks reuse a window of the same spa only
    (`{base}/{slug}`), else open a new one (Chrome opens it in that spa's installed app).
  - "Install app" in the profile menu (Chrome/Edge/Android `beforeinstallprompt`, kept from first paint by an inline
    listener; iOS → Share → Add to Home Screen steps sheet with the app name); one-time dismissible tip on the
    dashboard home for owners/managers (dismiss remembered per browser). Hidden when already running standalone.
  - Tests: core `pwa.test.ts` (name rule, initials); e2e `pwa.spec.ts` (manifest/icons cookie-free for a logo spa and
    a no-logo spa, 304/404, `<head>`, console/marketing manifests, SW control + Chrome installability via CDP,
    offline page, one server request per page load via a counting proxy, same-spa notification windows, uncached
    stand-in icon for an unreadable logo + throttled re-read, menu + tip + iOS steps).

### 18.8 Plans + pricing (owner 2026-10-09, replaces "AED 24,000 per spa per year")
- **Premium:** setup AED 14,000 + AED 3,000/month, excl. VAT (VAT optional per invoice). Every feature, incl. backlog F9–F15 when built.
- **Standard:** setup AED 9,000 + AED 2,000/month, excl. VAT (optional). Core only — no AI & Instagram automation (AI
  receptionist, IG DM replies/booking from chat, AI insights, receipt scan), no marketing tools (campaigns, Google
  Business + Instagram posting, review requests, win-back/birthday drafts, F15 growth extras), single branch only.
  Keeps: calendar & rooms, online booking, POS, tax invoices, packages/gift cards/memberships, clients & intake, staff,
  commission, payroll/WPS, inventory, WhatsApp click-to-send reminders, website, reports, EN/TH, 2FA, PWA.
- **Existing spas** keep their AED 24,000/year subscription until their annual renewal date, then move to a new plan.
  New spas: setup + monthly. No yearly option for new plans.
- **Super-admin overrides per spa:** custom discount on the setup fee and/or the monthly fee (amount or %), and a
  feature-tier override (e.g. Premium features while billed at the Standard rate). Audited.
- Marketing pricing headline: "Pick your plan. We handle the rest." Home page gets a CRM showcase section with 3D
  scrolling (respecting reduced motion).
- **Home CRM showcase ✅** (2026-10-09, replaces the §18.5 home "Spa CRM" label table): headline + 3 benefits + CTAs
  "See the Spa CRM" (/crm) and "Apply for your spa" (app /signup); EN/ภาษาไทย toggle; the large dashboard mock
  (`CrmDashboard overview`: sidebar with the shell's icons, KPI row, Up next, Check out; real catalogue strings, CRM
  look) lies back in 3D (rotateX 24°, rotateZ −4°, scale 0.9; phones 12° / −2° / 0.95) and is flat once its centre
  reaches the viewport centre (phones: top in the upper third); 4 cards (calendar clash = `errors.domain.timeClashes`,
  tax invoice, WhatsApp queue "Open in WhatsApp", therapist "My earnings") drift at 4 depths around it, stacked
  below it under 1024 px. Motion = CSS scroll-driven animations (`animation-timeline` on untransformed wrappers'
  `view-timeline`s, transform/opacity only, inside `@supports` + `prefers-reduced-motion: no-preference`); browsers
  without it get the same curves from an IntersectionObserver-gated, scroll-scheduled rAF in `crm-showcase.tsx`
  (cached offsets, no per-frame layout reads). Reduced motion → static flat layout (an exception to the "motion for
  everyone" rule of motion.tsx, as the owner asked here). The /crm demo shares the mock, so it got the CRM look too;
  phones show the mock's menu as one fading row so EN/TH keep the same height (mock grid columns are
  `minmax(0,1fr)`, else that row's min-content widens the phone mock). ≥ 1024 px the earnings card hangs below the
  till total; ≥ 1440 px the cards sit further out beside the page column. Probe (production build, 390 px slow
  scroll + 4 address-bar resizes, CSS and JS-fallback paths): 0 frames > 50 ms, 0 blank frames, CLS 0, no
  horizontal scroll. e2e: `marketing-crm.spec`.
- **Implemented (2026-10-09, plans + entitlements + overrides + pricing page; the home page is a separate task):**
  - Plans by **code** (`premium`, `standard`, `legacy-yearly`; `PLAN_CODES` in `@spa/core`): seed `defaultPlans` +
    migration 0036 (hand-written data step: the old `standard` yearly row becomes `legacy-yearly`, inactive, same id,
    every feature → existing subscriptions untouched; Premium/Standard inserted). `price_aed` stays the 12-month
    price (36,000 / 24,000) billed as 12 monthly invoices (`billing_interval = month`); shown per month everywhere.
  - **Entitlements** = one source of truth in `packages/core/src/plans.ts`: features `ai` (AI receptionist, Instagram
    inbox + DM replies/booking from chat, AI insights, receipt scan, AI tools/Meta MCP), `marketing` (campaigns incl.
    win-back/birthday segments, Google Business + Instagram posting, review requests/replies, quiet-slot offers),
    `multiBranch`. Plan switches in `plans.limits` (missing = included, so custom/old plans keep everything);
    effective = `tenants.feature_tier` override (`premium` | `standard`) else the plan. `PLAN_FEATURES` drives the
    pricing comparison; `AUTOMATION_FEATURE` maps gated automations (slotFiller, instagram, googleReviews,
    weeklyInsights). Website Studio AI agents (`STUDIO_AI_AGENTS`) are on every plan (the website is).
  - **Enforced server-side:** `guard(slug, perm, feature)` on every gated action (AI studio, inbox, campaigns,
    content/posting, reviews, Google sync/post, Meta MCP, insights refresh); route segments gate with `FeatureGate`
    layouts → "Available on Premium" page (`components/plan/upsell.tsx`, EN + TH); nav leaves them out (also the IG
    unread badge, AI meter/banners, insights card, receipt-scan reading — the receipt is still attached); AI gateway
    `assertAiAllowed` throws `AiNotInPlanError` (like the budget pause); worker: `automationOnSql` includes the
    entitlement (slot filler, IG publish, GBP sync, weekly insights skip), `instagram-reply` drops a Standard spa's
    rows unanswered. Impersonating super-admins see the spa's gating. DomainError `featureNotInPlan` (EN + TH).
  - **Standard = 1 active branch:** add / restore refused (`featureError('multiBranch')`). Decision: a downgraded spa's
    extra branches **keep working** (bookings, staff, reports — nothing hidden or broken); they can be edited and
    archived, not added or restored; the Branches tab stays for such a spa (with the Premium note), otherwise the
    single branch is edited under Settings → Profile and /settings/branches shows the upsell.
  - **Console spa page → Plan & features:** switch Premium ↔ Standard (optionally re-issuing unpaid invoices not yet
    due at the new price); legacy is read-only until **30 days before renewal**, then "Choose plan for renewal" starts
    a new 12-month period on the old end date (no setup fee; no automatic money movement — "Generate payment
    schedule" issues it); discounts on the setup fee and/or monthly fee (AED or %, `subscriptions.discounts`), applied
    when invoices are generated, optional re-issue of unpaid not-yet-due invoices (setup keeps its due date + VAT
    choice); feature tier (follow plan / grant Premium / Standard only). Audits: `platform.subscription.plan_switched`,
    `platform.subscription.discounts`, `platform.tenant.feature_tier` (from → to). The Subscription form no longer
    changes the plan. Plans page: per-month price, feature tier per plan, fixed codes.
  - **Accept dialog:** offered plans only (never legacy) with setup + monthly; setup + monthly discount fields with live
    totals (a setup fee discounted to 0 = no setup invoice); stored on the subscription. Invoices keep `list_aed`,
    `discount_aed`, `discount_label` + a description note; console, spa Billing page and application summary show them.
  - **Sign-up:** Premium + Standard with setup + monthly (EN + TH); `/signup?plan=<code>` (an id still works).
  - **Pricing page:** two plan cards, comparison generated from `PLAN_FEATURES`, FAQ (plans, setup fee, VAT, switching,
    existing yearly customers keep their plan until renewal), CTAs `/signup?plan=premium|standard`.
  - Open: the marketing **home page** still has its "One simple price … / year" block (not touched here — owner asked
    for a separate home-page task); it now shows the first plan's 12-month price.
