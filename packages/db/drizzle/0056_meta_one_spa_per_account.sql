-- R29: one spa per Meta account, across tenants (race-proof; the connect flows also hold an advisory lock on the
-- Instagram account id for the Instagram-Login-vs-Facebook-Page case). Production has no connected Meta rows yet (the
-- Meta keys were never set), so nothing there can violate these indexes and the two clean-up updates change no row.
-- They exist for development/test databases with duplicates: per account the newest connected row stays, the others
-- are disconnected (tokens wiped, as a disconnect does). 'facebook' is only compared as text and never named in the
-- index predicates: the value comes from 0028 (ALTER TYPE … ADD VALUE), and a fresh database runs every migration in
-- one transaction, where a value added earlier in it can't be used yet ("unsafe use of new value").
UPDATE "social_accounts" AS s SET "status" = 'disconnected', "token_enc" = NULL, "token_expires_at" = NULL
WHERE s."status" = 'connected' AND s."platform"::text IN ('instagram', 'facebook') AND EXISTS (
  SELECT 1 FROM "social_accounts" AS o
  WHERE o."status" = 'connected' AND o."platform" = s."platform" AND o."external_id" = s."external_id"
    AND (o."updated_at", o."id") > (s."updated_at", s."id")
);--> statement-breakpoint
UPDATE "social_accounts" AS s SET "status" = 'disconnected', "token_enc" = NULL, "token_expires_at" = NULL
WHERE s."status" = 'connected' AND s."platform"::text = 'facebook' AND s."meta" ->> 'igUserId' IS NOT NULL AND EXISTS (
  SELECT 1 FROM "social_accounts" AS o
  WHERE o."status" = 'connected' AND o."platform"::text = 'facebook' AND o."meta" ->> 'igUserId' = s."meta" ->> 'igUserId'
    AND (o."updated_at", o."id") > (s."updated_at", s."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_meta_connected" ON "social_accounts" USING btree ("platform","external_id") WHERE "social_accounts"."status" = 'connected' and "social_accounts"."platform" <> 'gbp';--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_fb_ig_connected" ON "social_accounts" USING btree (("meta" ->> 'igUserId')) WHERE "social_accounts"."platform" not in ('gbp', 'instagram') and "social_accounts"."status" = 'connected';
