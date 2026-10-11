CREATE TYPE "public"."change_request_status" AS ENUM('open', 'done', 'declined');--> statement-breakpoint
CREATE TYPE "public"."site_studio_status" AS ENUM('building', 'review', 'approved');--> statement-breakpoint
CREATE TABLE "site_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid,
	"body" text NOT NULL,
	"status" "change_request_status" DEFAULT 'open' NOT NULL,
	"response" text,
	"created_by" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "studio_status" "site_studio_status" DEFAULT 'building' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_change_requests" ADD CONSTRAINT "site_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_change_requests" ADD CONSTRAINT "site_change_requests_page_id_site_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_change_requests" ADD CONSTRAINT "site_change_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_change_requests" ADD CONSTRAINT "site_change_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_change_requests_status" ON "site_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_change_requests" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_change_requests" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Sites that are already live were approved under the old self-serve builder.
UPDATE "sites" SET "studio_status" = 'approved' WHERE EXISTS (SELECT 1 FROM "page_versions" v JOIN "site_pages" p ON p."id" = v."page_id" WHERE p."site_id" = "sites"."id" AND v."status" = 'published');
