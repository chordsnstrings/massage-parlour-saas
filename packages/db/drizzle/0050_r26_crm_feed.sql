ALTER TABLE "staff" ADD COLUMN "show_on_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "booking" jsonb;