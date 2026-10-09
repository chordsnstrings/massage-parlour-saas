-- Owner 2026-10-09: the only spamanagement.co address anywhere is ask@spamanagement.co (company email shown on the
-- marketing site, and a console "From" address if one was saved with another spamanagement.co mailbox).
UPDATE "platform_settings" SET "email" = 'ask@spamanagement.co'
  WHERE "email" ILIKE '%@spamanagement.co' AND lower("email") <> 'ask@spamanagement.co';--> statement-breakpoint
UPDATE "platform_settings" SET "email_from" = regexp_replace("email_from", '[A-Za-z0-9._%+-]+@spamanagement\.co', 'ask@spamanagement.co', 'gi')
  WHERE "email_from" ~* '@spamanagement\.co' AND "email_from" !~* 'ask@spamanagement\.co';
