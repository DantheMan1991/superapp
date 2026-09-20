-- The question on the screen right now (X2a, ADR 0098).
--
-- A walk is forty-five minutes long and somebody will reload, close the
-- laptop or come back after lunch. An answer row is only written once there
-- IS an answer, so without these the pending question is the one thing a
-- refresh would lose.

ALTER TABLE "job_estimate_interviews" ADD COLUMN "pending_say" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD COLUMN "pending_question_id" uuid;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD COLUMN "pending_quick_replies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD CONSTRAINT "job_estimate_interviews_quick_replies_list" CHECK (jsonb_typeof("job_estimate_interviews"."pending_quick_replies") = 'array');