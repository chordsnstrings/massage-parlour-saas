-- R29: one spa per Google Business Profile location, across tenants (race-proof; the location step also checks first
-- and maps a violation to "already connected to another spa"). A chosen location counts while connected or waiting
-- for a reconnect ('error'), so a reconnect back to 'connected' can never collide; 'pending' = no location chosen.
-- Production has no Google connections yet (Business Profile API access not approved), so the clean-up changes no
-- row there. For development/test databases with duplicates: per location the newest row keeps it, the others go back
-- to the location picker (tokens kept) or, when that spa somehow already has a picker row, are deleted. Only 'gbp' is
-- named (a CREATE TYPE value, safe in one-transaction fresh migrations; 'facebook' is never used here).
UPDATE "social_accounts" AS s SET "external_id" = 'pending', "status" = 'pending_location', "username" = NULL, "meta" = '{}'::jsonb
WHERE s."platform" = 'gbp' AND s."status" IN ('connected', 'error') AND s."external_id" <> 'pending'
  AND EXISTS (
    SELECT 1 FROM "social_accounts" AS o
    WHERE o."platform" = 'gbp' AND o."status" IN ('connected', 'error') AND o."external_id" = s."external_id"
      AND (o."updated_at", o."id") > (s."updated_at", s."id")
  )
  AND NOT EXISTS (
    SELECT 1 FROM "social_accounts" AS p
    WHERE p."tenant_id" = s."tenant_id" AND p."platform" = 'gbp' AND p."external_id" = 'pending'
  );--> statement-breakpoint
DELETE FROM "social_accounts" AS s
WHERE s."platform" = 'gbp' AND s."status" IN ('connected', 'error') AND s."external_id" <> 'pending'
  AND EXISTS (
    SELECT 1 FROM "social_accounts" AS o
    WHERE o."platform" = 'gbp' AND o."status" IN ('connected', 'error') AND o."external_id" = s."external_id"
      AND (o."updated_at", o."id") > (s."updated_at", s."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_gbp_location" ON "social_accounts" USING btree ("external_id") WHERE "social_accounts"."platform" = 'gbp' and "social_accounts"."status" in ('connected', 'error') and "social_accounts"."external_id" <> 'pending';
