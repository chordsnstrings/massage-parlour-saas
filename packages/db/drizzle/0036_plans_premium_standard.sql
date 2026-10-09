CREATE TYPE "public"."feature_tier" AS ENUM('premium', 'standard');--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "list_aed" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "discount_aed" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "discount_label" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discounts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "feature_tier" "feature_tier";--> statement-breakpoint
-- hand-written (PLAN §18.8, owner 2026-10-09): plans by code, never by id. The pre-§18.8 plan (code `standard`,
-- AED 24,000 per year) becomes the inactive legacy plan with every feature: existing subscriptions keep pointing at
-- it (same id) until their renewal. Runs once; skipped when a `legacy-yearly` row already exists.
UPDATE "plans" SET "code" = 'legacy-yearly', "name" = 'Yearly (legacy)', "active" = false, "sort" = 90,
  "limits" = "limits" || '{"ai": true, "marketing": true, "multiBranch": true}'::jsonb, "updated_at" = now()
WHERE "code" = 'standard' AND NOT EXISTS (SELECT 1 FROM "plans" WHERE "code" = 'legacy-yearly');--> statement-breakpoint
-- New plans (same rows as `defaultPlans` in src/seed.ts): price_aed = 12 months (12 monthly invoices), excl. VAT.
INSERT INTO "plans" ("code", "name", "description", "price_aed", "setup_fee_aed", "billing_interval", "trial_days", "limits", "active", "sort") VALUES
  ('premium', 'Premium', 'Everything: AI receptionist and Instagram automation, marketing tools and as many branches as you need.', 36000, 14000, 'month', 14, '{"ai": true, "marketing": true, "multiBranch": true}'::jsonb, true, 1),
  ('standard', 'Standard', 'The spa CRM: calendar, online booking, POS, accounts, staff, payroll, inventory and your website, for one branch.', 24000, 9000, 'month', 14, '{"ai": false, "marketing": false, "multiBranch": false}'::jsonb, true, 2)
ON CONFLICT ("code") DO NOTHING;
