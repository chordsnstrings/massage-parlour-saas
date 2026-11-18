CREATE TABLE "instagram_reply_queue" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_reply_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_job_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_job_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instagram_reply_queue" ADD CONSTRAINT "instagram_reply_queue_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_reply_queue" ADD CONSTRAINT "instagram_reply_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instagram_reply_queue_due" ON "instagram_reply_queue" USING btree ("next_at") WHERE "instagram_reply_queue"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "platform_job_runs_job_finished" ON "platform_job_runs" USING btree ("job","finished_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "instagram_reply_queue" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "instagram_reply_queue" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "platform_all" ON "platform_job_runs" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);