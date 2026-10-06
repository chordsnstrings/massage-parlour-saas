ALTER TABLE "campaigns" ADD COLUMN "rules" jsonb;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "stats" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_campaign" ON "outbox" USING btree ("campaign_id");