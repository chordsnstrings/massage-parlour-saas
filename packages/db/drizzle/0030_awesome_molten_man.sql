ALTER TABLE "platform_settings" ADD COLUMN "resend_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "resend_api_key_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "email_from" text;