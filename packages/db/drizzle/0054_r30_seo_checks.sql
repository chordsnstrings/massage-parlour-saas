CREATE TYPE "public"."seo_check_trigger" AS ENUM('weekly', 'manual');--> statement-breakpoint
CREATE TABLE "seo_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{"high":0,"medium":0}'::jsonb NOT NULL,
	"trigger" "seo_check_trigger" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seo_checks" ADD CONSTRAINT "seo_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_checks" ADD CONSTRAINT "seo_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_checks_site_checked" ON "seo_checks" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seo_checks" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "seo_checks" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);