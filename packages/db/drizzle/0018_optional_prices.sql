ALTER TABLE "booking_items" ALTER COLUMN "price_aed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_variants" ALTER COLUMN "price_aed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "show_price" boolean;