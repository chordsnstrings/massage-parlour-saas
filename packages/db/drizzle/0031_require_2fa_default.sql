-- G23 (owner decision 2026-10-09): "Require 2FA for owner & managers" is on for every spa; owners may turn it off.
UPDATE "tenants" SET "settings" = jsonb_set(coalesce("settings", '{}'::jsonb), '{require2fa}', 'true'::jsonb, true);
