ALTER TABLE "conversation_messages" ADD COLUMN "kind" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;