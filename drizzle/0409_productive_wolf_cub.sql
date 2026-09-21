ALTER TABLE "job_estimate_interviews" ADD COLUMN "pending_measure_id" uuid;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD COLUMN "measured_at" timestamp with time zone;