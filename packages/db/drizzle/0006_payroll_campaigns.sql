ALTER TABLE "outbox" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "payroll" jsonb DEFAULT '{}'::jsonb NOT NULL;