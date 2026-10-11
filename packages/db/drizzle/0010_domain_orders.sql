CREATE TYPE "public"."domain_order_status" AS ENUM('requested', 'purchasing', 'purchased', 'failed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "domain_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"years" integer DEFAULT 1 NOT NULL,
	"price_usd" numeric(10, 2) NOT NULL,
	"price_aed" numeric(10, 2) NOT NULL,
	"premium" boolean DEFAULT false NOT NULL,
	"status" "domain_order_status" DEFAULT 'requested' NOT NULL,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"charged_usd" numeric(10, 2),
	"registrar_order_id" text,
	"registrar_domain_id" text,
	"domain_id" uuid,
	"note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_orders_tenant" ON "domain_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_orders_open_domain" ON "domain_orders" USING btree ("domain") WHERE "domain_orders"."status" in ('requested', 'purchasing', 'purchased');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "domain_orders" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "domain_orders" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);