ALTER TABLE "platform_settings" ADD COLUMN "google_client_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "google_client_secret_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "google_client_secret_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_app_id" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_app_secret_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_app_secret_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_webhook_verify_token_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_webhook_verify_token_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "meta_fb_config_id" text;