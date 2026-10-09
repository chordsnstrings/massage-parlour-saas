CREATE TYPE "public"."spa_application_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "spa_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "spa_application_status" DEFAULT 'pending' NOT NULL,
	"user_id" text NOT NULL,
	"applicant_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"spa_name" text NOT NULL,
	"slug" text NOT NULL,
	"emirate" text NOT NULL,
	"street_address" text NOT NULL,
	"plan_id" uuid,
	"preferred_start" date NOT NULL,
	"notes" text,
	"logo_bytes" "bytea",
	"logo_content_type" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"share_reason" boolean DEFAULT false NOT NULL,
	"created_tenant_id" uuid,
	"setup_payment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spa_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spa_applications" ADD CONSTRAINT "spa_applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_applications" ADD CONSTRAINT "spa_applications_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_applications" ADD CONSTRAINT "spa_applications_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_applications" ADD CONSTRAINT "spa_applications_created_tenant_id_tenants_id_fk" FOREIGN KEY ("created_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_applications_pending_slug" ON "spa_applications" USING btree ("slug") WHERE "spa_applications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "spa_applications_pending_user" ON "spa_applications" USING btree ("user_id") WHERE "spa_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "spa_applications_status_created" ON "spa_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE POLICY "platform_all" ON "spa_applications" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);