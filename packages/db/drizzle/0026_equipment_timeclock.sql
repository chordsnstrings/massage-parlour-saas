CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'unpaid');--> statement-breakpoint
ALTER TYPE "public"."resource_kind" ADD VALUE 'equipment';--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_dates" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date")
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"business_date" date NOT NULL,
	"source" text DEFAULT 'kiosk' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_order" CHECK ("time_entries"."clock_out" IS NULL OR "time_entries"."clock_out" > "time_entries"."clock_in")
);
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "unpaid_leave_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "worked_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_items" ADD COLUMN "equipment_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "equipment_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_branch_type" ON "equipment" USING btree ("branch_id","type");--> statement-breakpoint
CREATE INDEX "leave_staff_dates" ON "leave_requests" USING btree ("staff_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_open" ON "time_entries" USING btree ("staff_id") WHERE "time_entries"."clock_out" IS NULL;--> statement-breakpoint
CREATE INDEX "time_entries_staff_date" ON "time_entries" USING btree ("staff_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "equipment" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leave_requests" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "leave_requests" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "time_entries" AS PERMISSIVE FOR ALL TO "spa_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_all" ON "time_entries" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);--> statement-breakpoint
-- hand-written (X7)
-- One person's clock entries never overlap (open entries run to infinity). The new `equipment` resource_kind
-- value is not used in this migration (Postgres can't use an enum value added in the same transaction); the
-- reservations EXCLUDE (resource_kind =, resource_id =, period &&) covers it unchanged.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_no_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, tstzrange("clock_in", coalesce("clock_out", 'infinity'::timestamptz)) WITH &&);
--> statement-breakpoint
-- A person can't hold two live (pending/approved) leave requests over the same dates.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_no_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&) WHERE ("status" <> 'rejected');
