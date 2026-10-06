ALTER TABLE "conversation_messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_external" ON "conversation_messages" USING btree ("tenant_id","external_id") WHERE "conversation_messages"."external_id" is not null;