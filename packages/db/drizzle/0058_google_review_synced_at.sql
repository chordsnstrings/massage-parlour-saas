-- R29: Business Profile API content is stored "for no more than 30 calendar days". synced_at = the last sync in which
-- the Google API returned the review (refreshed on every sync; the daily purge deletes rows not refreshed for 29 days,
-- so one run a day keeps nothing past 30).
-- Hand-pasted reviews (external_id 'manual-…') stay NULL and are never purged. Existing API rows start the clock now.
ALTER TABLE "reviews" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
UPDATE "reviews" SET "synced_at" = now()
WHERE "source" = 'google' AND "external_id" ~ '^accounts/[\w-]+/locations/[\w-]+/reviews/[\w-]+$';--> statement-breakpoint
CREATE INDEX "reviews_synced_at" ON "reviews" USING btree ("synced_at") WHERE "reviews"."synced_at" is not null;
