ALTER TABLE "job_estimates" ADD COLUMN "presentation" text DEFAULT 'lines' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD COLUMN "scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD COLUMN "exclusions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD COLUMN "terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_presentation_valid" CHECK ("job_estimates"."presentation" in ('lines', 'codes', 'sum'));