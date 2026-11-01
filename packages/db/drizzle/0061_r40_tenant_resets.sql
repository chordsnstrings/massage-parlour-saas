CREATE TABLE "tenant_resets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenant_resets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reset_tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"reset_by" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"snapshot_size" integer NOT NULL,
	"files_deleted" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "tenant_resets_tenant" ON "tenant_resets" USING btree ("reset_tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "platform_all" ON "tenant_resets" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);