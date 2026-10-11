CREATE TYPE "public"."site_enquiry_status" AS ENUM('new', 'replied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."site_post_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "site_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "site_enquiry_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"ip_hash" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" "site_post_status" DEFAULT 'draft' NOT NULL,
	"title" jsonb NOT NULL,
	"excerpt" jsonb DEFAULT '{"en":""}'::jsonb NOT NULL,
	"body" jsonb DEFAULT '{"en":""}'::jsonb NOT NULL,
	"cover_image" text,
	"seo_title" jsonb DEFAULT '{"en":""}'::jsonb NOT NULL,
	"seo_description" jsonb DEFAULT '{"en":""}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_posts_slug" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
ALTER TABLE "site_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_enquiries_status_created" ON "site_enquiries" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "site_posts_published" ON "site_posts" USING btree ("tenant_id","status","published_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_enquiries" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_enquiries" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "site_posts" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_posts" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);