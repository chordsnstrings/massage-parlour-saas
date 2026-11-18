CREATE TYPE "public"."contact_enquiry_status" AS ENUM('new', 'contacted', 'closed');--> statement-breakpoint
CREATE TABLE "contact_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "contact_enquiry_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"spa_name" text NOT NULL,
	"message" text NOT NULL,
	"admin_note" text,
	"ip_hash" text,
	"user_agent" text,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_enquiries" ADD CONSTRAINT "contact_enquiries_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_enquiries_status_created" ON "contact_enquiries" USING btree ("status","created_at");--> statement-breakpoint
CREATE POLICY "platform_all" ON "contact_enquiries" AS PERMISSIVE FOR ALL TO "spa_platform" USING (true) WITH CHECK (true);