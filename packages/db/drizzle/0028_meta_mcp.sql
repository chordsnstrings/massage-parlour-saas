ALTER TYPE "public"."social_platform" ADD VALUE 'facebook';--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_mcp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_mcp_url" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_mcp_key_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_mcp_tools" text[] DEFAULT '{}' NOT NULL;