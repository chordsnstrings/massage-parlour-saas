-- Website booking source (owner 2026-10-13): staff-made Website bookings (Enquiries → Make booking, or the Website
-- source in New booking) record attribution 'website', so reports show them as website bookings, not "Not recorded".
-- Adding an enum value is safe inside the migration transaction (PG 16; nothing here uses it).
ALTER TYPE "public"."booking_attribution" ADD VALUE 'website';
