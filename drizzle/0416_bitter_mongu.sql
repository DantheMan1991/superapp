ALTER TABLE "job_estimate_outline_questions" ADD COLUMN "standard_answer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_interview_answers" ADD COLUMN "from_standard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD COLUMN "usual_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD COLUMN "usual_accepted" boolean;