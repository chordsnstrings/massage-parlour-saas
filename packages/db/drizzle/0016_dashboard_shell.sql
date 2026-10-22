ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_file_id_stored_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;