ALTER TABLE "job_estimate_interviews" ADD COLUMN "pending_price_line_id" uuid;--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" ADD COLUMN "price_passed_at" timestamp with time zone;