CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"object_key" text,
	"bytes" "bytea",
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"filename" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"purpose" text DEFAULT 'media' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"theme" jsonb NOT NULL,
	"pages" jsonb NOT NULL,
	"preview_image_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "site_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verification_token" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "ssl_status" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_templates" ADD CONSTRAINT "site_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_tenant" ON "stored_files" USING btree ("tenant_id","purpose");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stored_files" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "stored_files" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_templates" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);