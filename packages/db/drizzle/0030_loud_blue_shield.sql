ALTER TYPE "public"."message_kind" ADD VALUE 'membership_renewal';--> statement-breakpoint
ALTER TYPE "public"."sale_line_kind" ADD VALUE 'membership';--> statement-breakpoint
ALTER TYPE "public"."membership_status" ADD VALUE 'due';--> statement-breakpoint
ALTER TYPE "public"."membership_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."membership_status" ADD VALUE 'refunded';--> statement-breakpoint
CREATE TABLE "membership_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_membership_id" uuid NOT NULL,
	"service_id" uuid,
	"sale_id" uuid,
	"value_aed" numeric(12, 2) NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_purges" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenant_purges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"purged_tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"purged_by" text,
	"mode" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"objects_deleted" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_purges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "price_paid_aed" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "remaining_value_aed" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "sale_line_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "resend_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "resend_api_key_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "email_from" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "auto_purge_days" integer;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_redemptions" ADD CONSTRAINT "membership_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_redemptions" ADD CONSTRAINT "membership_redemptions_client_membership_id_client_memberships_id_fk" FOREIGN KEY ("client_membership_id") REFERENCES "public"."client_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_redemptions" ADD CONSTRAINT "membership_redemptions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_redemptions" ADD CONSTRAINT "membership_redemptions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_redemptions" ADD CONSTRAINT "membership_redemptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_memberships_sale" ON "client_memberships" USING btree ("sale_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_redemptions" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "membership_redemptions" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "platform_all" ON "tenant_purges" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);