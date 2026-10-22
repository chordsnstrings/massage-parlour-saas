-- R32 daily sales sheet (owner 2026-10-14): the day-sheet PDF rendered when a day is closed is stored with that
-- close (private file, purpose day_sheet_pdf); an owner/manager correction of the closed day regenerates it.
ALTER TABLE "day_closes" ADD COLUMN "pdf_file_id" uuid;--> statement-breakpoint
ALTER TABLE "day_closes" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "day_closes" ADD COLUMN "pdf_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_pdf_file_id_stored_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;