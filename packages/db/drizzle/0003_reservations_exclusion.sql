-- Double-booking is impossible at the database level: no two holds on the same staff member or room may overlap.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist ("resource_kind" WITH =, "resource_id" WITH =, "period" WITH &&);--> statement-breakpoint
-- Shifts of the same therapist may not overlap either.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_no_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);--> statement-breakpoint
CREATE INDEX "reservations_period" ON "reservations" USING gist ("resource_id", "period");
