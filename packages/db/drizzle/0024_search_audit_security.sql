CREATE INDEX "audit_log_tenant_created" ON "audit_log" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- hand-written (X5): global search (PLAN §14.7 B4). pg_trgm is a trusted extension, so the database owner
-- (spa_owner, runs migrations) may create it; trigram GIN indexes serve ILIKE '%q%' and word similarity (<%).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_name_trgm" ON "clients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_phone_trgm" ON "clients" USING gin ("phone_e164" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_ref_trgm" ON "bookings" USING gin ("ref_code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_name_trgm" ON "staff" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_name_en_trgm" ON "services" USING gin (("name"->>'en') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_name_ar_trgm" ON "services" USING gin (("name"->>'ar') gin_trgm_ops);
