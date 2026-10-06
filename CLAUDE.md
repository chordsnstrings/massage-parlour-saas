# spamanagement.ae — Claude notes

Multi-tenant SaaS for UAE massage parlours. **Source of truth: `docs/PLAN.md`** — read the relevant section, not the whole file.
Status: planning; no app code until the plan is approved.

## Locked decisions (don't re-litigate)
- UAE only: AED, Asia/Dubai (store UTC), EN + AR (RTL) tenant sites.
- Payments are **recorded, never processed** (cash / own card terminal / bank transfer). SaaS billing also manual. Stripe later.
- Customer comms = **WhatsApp click-to-send only** (wa.me / web.whatsapp.com / whatsapp:// links). No SMS, no customer email,
  no unofficial WhatsApp automation libraries.
- AI = BytePlus ModelArk, Seed 2.0 family by default; model IDs live in DB config (`ai_model_config`), never hard-coded.
- Infra ≤ USD 50/month: one DO droplet (docker compose: web, worker, postgres, cloudflared) behind Cloudflare Free. No Redis.
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

## Verification policy (token-efficient)
- After each edit: typecheck + lint + tests for touched packages + the one e2e spec for the touched flow.
- Full e2e suite only at phase milestones. No whole-app re-verification per change.

## Commands
_To be filled in by P0 task 1 (scaffold)._
