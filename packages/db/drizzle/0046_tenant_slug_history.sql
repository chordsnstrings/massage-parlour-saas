CREATE TABLE "tenant_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"renamed_tenant_id" uuid NOT NULL,
	"renamed_by" text,
	"renamed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_slug_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_slug_history" ADD CONSTRAINT "tenant_slug_history_renamed_tenant_id_tenants_id_fk" FOREIGN KEY ("renamed_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_slug_history_tenant" ON "tenant_slug_history" USING btree ("renamed_tenant_id");--> statement-breakpoint
CREATE POLICY "platform_all" ON "tenant_slug_history" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);