-- R32 booking <-> sale order (owner 2026-10-14): bookings get the phone line (P1-P4), the client type picked by
-- reception (regular/new) and the therapist's own-lead flag; booking_items get the planned commission (off the ledger
-- until Finish) and when the fee/commission were typed (prefill index); expenses can come from the drawer (Daily
-- close); day_closes record a later correction by an owner/manager. CREATE TYPE in the same run is safe (only
-- ALTER TYPE ... ADD VALUE must not be used in the run that adds it).
CREATE TYPE "public"."booking_client_type" AS ENUM('regular', 'new');--> statement-breakpoint
ALTER TABLE "day_closes" ADD COLUMN "amended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "day_closes" ADD COLUMN "amended_by" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "from_drawer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_items" ADD COLUMN "commission_aed" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "booking_items" ADD COLUMN "terms_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "phone_line" smallint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_type" "booking_client_type";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "own_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_amended_by_user_id_fk" FOREIGN KEY ("amended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_drawer_day" ON "expenses" USING btree ("branch_id","expense_date") WHERE "expenses"."from_drawer";--> statement-breakpoint
CREATE INDEX "booking_items_variant_terms" ON "booking_items" USING btree ("tenant_id","service_variant_id","terms_set_at" DESC NULLS LAST) WHERE "booking_items"."terms_set_at" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_phone_line" CHECK ("bookings"."phone_line" is null or "bookings"."phone_line" between 1 and 4);