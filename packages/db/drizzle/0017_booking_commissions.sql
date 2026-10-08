CREATE TYPE "public"."staff_pay_type" AS ENUM('booking_commission', 'salary', 'sales_commission');--> statement-breakpoint
CREATE TABLE "booking_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_item_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount_aed" numeric(12, 2) NOT NULL,
	"payroll_run_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_commissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pay_type" "staff_pay_type" DEFAULT 'booking_commission' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_booking_item_id_booking_items_id_fk" FOREIGN KEY ("booking_item_id") REFERENCES "public"."booking_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_commissions_booking" ON "booking_commissions" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_commissions_staff_date" ON "booking_commissions" USING btree ("staff_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_commissions" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "booking_commissions" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
-- hand-written (W2)
-- Existing people: bookable staff are therapists (paid per booking); the rest keep their salary, or their % if
-- they only had a commission rate.
UPDATE "staff" SET "pay_type" = CASE
  WHEN "bookable" THEN 'booking_commission'::staff_pay_type
  WHEN "base_salary_aed" = 0 AND "commission_pct" > 0 THEN 'sales_commission'::staff_pay_type
  ELSE 'salary'::staff_pay_type
END;--> statement-breakpoint
-- Append-only amounts: corrections are new rows; only the payroll link may be set later.
CREATE OR REPLACE FUNCTION booking_commissions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user = 'spa_app' THEN
      RAISE EXCEPTION 'booking commissions are append-only — insert a correction instead' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.amount_aed, NEW.staff_id, NEW.booking_item_id, NEW.business_date) IS DISTINCT FROM
     (OLD.amount_aed, OLD.staff_id, OLD.booking_item_id, OLD.business_date) THEN
    RAISE EXCEPTION 'booking commissions are append-only — insert a correction instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "booking_commissions_append_only" BEFORE UPDATE OR DELETE ON "booking_commissions" FOR EACH ROW EXECUTE FUNCTION booking_commissions_append_only();
