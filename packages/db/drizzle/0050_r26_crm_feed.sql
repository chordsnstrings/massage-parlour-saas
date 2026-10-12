ALTER TABLE "staff" ADD COLUMN "show_on_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "booking" jsonb;--> statement-breakpoint
-- R26: "Show on website" is the one public-staff rule (block Team sections too). Staff a live Team section shows today (active + bookable, the old rule) keep showing; everyone else starts off.
UPDATE "staff" st SET "show_on_site" = true
WHERE st."active" AND st."bookable" AND (
  EXISTS (
    SELECT 1 FROM "site_pages" sp
    JOIN LATERAL (
      SELECT pv."data" FROM "page_versions" pv
      WHERE pv."page_id" = sp."id" AND pv."status" = 'published'
      ORDER BY pv."created_at" DESC LIMIT 1
    ) v ON true
    WHERE sp."tenant_id" = st."tenant_id" AND sp."visible"
      AND jsonb_path_exists(v."data", '$.** ? (@.type == "Team")')
  )
  OR EXISTS (
    SELECT 1 FROM "saved_sections" ss
    WHERE ss."tenant_id" = st."tenant_id" AND ss."is_global"
      AND jsonb_path_exists(ss."data", '$.** ? (@.type == "Team")')
  )
);
