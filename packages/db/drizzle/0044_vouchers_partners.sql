CREATE TABLE "booking_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_partners_code" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "booking_partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "check_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "voucher_service_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_partners" ADD CONSTRAINT "booking_partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_partners" ADD CONSTRAINT "booking_partners_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_voucher_service_id_services_id_fk" FOREIGN KEY ("voucher_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partner_id_booking_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."booking_partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_partner" ON "bookings" USING btree ("tenant_id","partner_id") WHERE "bookings"."partner_id" is not null;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_check_token" UNIQUE("check_token");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_partners" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "booking_partners" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);