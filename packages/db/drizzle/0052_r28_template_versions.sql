ALTER TABLE "site_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_templates" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_templates" ADD COLUMN "pending" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "text_run" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "template_hold" jsonb;