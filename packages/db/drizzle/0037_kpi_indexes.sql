CREATE INDEX "booking_items_booking" ON "booking_items" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "shifts_branch_time" ON "shifts" USING btree ("branch_id","starts_at");