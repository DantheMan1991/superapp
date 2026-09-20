ALTER TABLE "job_estimate_groups" ADD COLUMN "section" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_groups" ADD COLUMN "show_lines" boolean DEFAULT true NOT NULL;