ALTER TABLE "site_enquiries" ADD COLUMN "booking_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "booking_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "booking_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "schedule_item_id" uuid;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_booking_whole" CHECK (("site_enquiries"."booking_starts_at" is null) = ("site_enquiries"."booking_ends_at" is null));