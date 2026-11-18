ALTER TYPE "public"."staff_pay_type" ADD VALUE 'booking_fee';--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "fee_aed" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- hand-written (integration, R2/R3 owner decisions 2026-10-08)
-- Subscriptions stored as a monthly price move to the yearly price (× 12) on the 12-month plan (12 monthly
-- invoices). "Monthly" = 12-month plan, or ≈ the plan's yearly price / 12; less than half the plan's yearly
-- price either way, so a converted row never matches again (idempotent). Same rule: services
-- `convertMonthlySubscriptions`.
UPDATE "subscriptions" s SET "price_aed" = round(s."price_aed" * 12, 2), "billing_interval" = 'month', "updated_at" = now()
FROM "plans" p
WHERE p."id" = s."plan_id" AND s."price_aed" > 0 AND s."price_aed" * 2 < p."price_aed"
  AND (s."billing_interval" = 'month' OR abs(s."price_aed" * 12 - p."price_aed") <= p."price_aed" * 0.05);
