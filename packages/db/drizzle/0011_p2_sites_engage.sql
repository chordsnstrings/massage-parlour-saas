ALTER TABLE "business_documents" ADD COLUMN "issued_on" date;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "template_undo" jsonb;