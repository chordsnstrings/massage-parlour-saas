ALTER TABLE "platform_settings" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;