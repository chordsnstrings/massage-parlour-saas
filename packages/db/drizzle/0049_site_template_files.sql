CREATE TABLE "site_template_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"bytes" "bytea",
	"object_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_template_files_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
ALTER TABLE "site_template_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_template_files" ADD CONSTRAINT "site_template_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "platform_all" ON "site_template_files" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);