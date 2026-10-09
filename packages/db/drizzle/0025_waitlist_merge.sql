CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'notified', 'booked', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'waitlist_slot' BEFORE 'custom';--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"service_id" uuid,
	"service_variant_id" uuid,
	"business_date" date NOT NULL,
	"from_at" timestamp with time zone,
	"until_at" timestamp with time zone,
	"notes" text,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"notified_at" timestamp with time zone,
	"booking_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_variant_id_service_variants_id_fk" FOREIGN KEY ("service_variant_id") REFERENCES "public"."service_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_branch_day" ON "waitlist_entries" USING btree ("branch_id","business_date","status");--> statement-breakpoint
CREATE INDEX "waitlist_client" ON "waitlist_entries" USING btree ("client_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "waitlist_entries" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "waitlist_entries" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
-- hand-written (X6)
-- A waitlist time window, when both ends are set, must not be empty.
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_window" CHECK ("from_at" IS NULL OR "until_at" IS NULL OR "from_at" < "until_at");
