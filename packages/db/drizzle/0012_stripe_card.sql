ALTER TYPE "public"."platform_payment_method" ADD VALUE 'card';--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "stripe_session_id" text;