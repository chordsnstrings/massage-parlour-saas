CREATE TYPE "public"."site_redirect_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TABLE "site_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_path" text NOT NULL,
	"from_query" text DEFAULT '' NOT NULL,
	"to_path" text NOT NULL,
	"source" "site_redirect_source" DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_redirects_from" UNIQUE("tenant_id","from_path","from_query")
);
--> statement-breakpoint
ALTER TABLE "site_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_redirects" ADD CONSTRAINT "site_redirects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_redirects" ADD CONSTRAINT "site_redirects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_redirects" ADD CONSTRAINT "site_redirects_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_redirects" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_redirects" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);