CREATE TABLE "csp_violations" (
	"day" date NOT NULL,
	"surface" text NOT NULL,
	"directive" text NOT NULL,
	"blocked" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_path" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "csp_violations_day_surface_directive_blocked_pk" PRIMARY KEY("day","surface","directive","blocked")
);
--> statement-breakpoint
ALTER TABLE "csp_violations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "turnstile_site_key" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "turnstile_secret_enc" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "turnstile_secret_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "turnstile_custom_domains" boolean;--> statement-breakpoint
CREATE POLICY "platform_all" ON "csp_violations" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);