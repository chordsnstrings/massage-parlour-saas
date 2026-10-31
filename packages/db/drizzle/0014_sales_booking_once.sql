-- F3: a booking is checked out at most once (voided sales free it up again).
-- Hand-edited: only create the index when no booking already has two non-void sales, so an existing
-- duplicate in production can't fail the deploy. Resolve duplicates (void one) and re-run the CREATE below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "sales"
    WHERE "booking_id" IS NOT NULL AND "status" <> 'void'
    GROUP BY "booking_id" HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'sales_booking_once not created: some bookings have more than one non-void sale';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "sales_booking_once" ON "sales" USING btree ("booking_id") WHERE "sales"."booking_id" is not null and "sales"."status" <> 'void';
  END IF;
END $$;
