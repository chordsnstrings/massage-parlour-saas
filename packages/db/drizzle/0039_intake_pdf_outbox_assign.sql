ALTER TABLE "outbox" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "assigned_by" text;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD COLUMN "pdf_file_id" uuid;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD COLUMN "pdf_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_assigned_to_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_pdf_file_id_stored_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_assignee" ON "outbox" USING btree ("tenant_id","assigned_to","status","due_at");--> statement-breakpoint
CREATE INDEX "outbox_auto_assigned" ON "outbox" USING btree ("tenant_id","assigned_at") WHERE "outbox"."assigned_to" is not null and "outbox"."assigned_by" is null;