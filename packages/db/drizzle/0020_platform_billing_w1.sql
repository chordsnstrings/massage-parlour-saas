CREATE TYPE "public"."platform_invoice_kind" AS ENUM('plan', 'setup', 'other');--> statement-breakpoint
CREATE TABLE "platform_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message" text NOT NULL,
	"amount_aed" numeric(12, 2) NOT NULL,
	"created_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD COLUMN "markup_usd" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "kind" "platform_invoice_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "installment" smallint;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "installments" smallint;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "domain_markup_usd" numeric(10, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_reminders" ADD CONSTRAINT "platform_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_reminders" ADD CONSTRAINT "platform_reminders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_reminders_tenant" ON "platform_reminders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_plan_installment" ON "platform_invoices" USING btree ("tenant_id","period_start","installments","installment") WHERE "platform_invoices"."kind" = 'plan' and "platform_invoices"."status" <> 'void';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_one_setup" ON "platform_invoices" USING btree ("tenant_id") WHERE "platform_invoices"."kind" = 'setup' and "platform_invoices"."status" <> 'void';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_reminders" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "platform_reminders" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);