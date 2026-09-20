-- The walk: an estimate priced by going through the job and answering
-- questions (X2a, ADR 0098).
--
-- HAND-REORDERED, as 0389, 0379, 0356 and 0352 had to be. drizzle emits every
-- foreign key before every index, so `job_estimate_interview_answers_interview_fk`
-- -- which references job_estimate_interviews (tenant_id, id) -- landed before
-- the unique index that makes those columns a legal target, and Postgres
-- refuses a composite FK with no unique constraint behind it. The parent's
-- unique index is moved ahead of the child's key.
--
-- `step_id` and `question_id` on an answer carry NO foreign key on purpose: a
-- transcript is a record of what happened, and an answer that vanished
-- because somebody tidied the outline afterwards would be a record that lies.

CREATE TABLE "job_estimate_interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"step_id" uuid,
	"step_title" text DEFAULT '' NOT NULL,
	"question_id" uuid,
	"prompt" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"skip_reason" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_interview_answers_prompt_present" CHECK (length(btrim("job_estimate_interview_answers"."prompt")) > 0),
	CONSTRAINT "job_estimate_interview_answers_skip_whole" CHECK (("job_estimate_interview_answers"."skipped" and length(btrim("job_estimate_interview_answers"."skip_reason")) > 0 and "job_estimate_interview_answers"."answer" = '')
          or (not "job_estimate_interview_answers"."skipped" and "job_estimate_interview_answers"."skip_reason" = ''))
);
--> statement-breakpoint
CREATE TABLE "job_estimate_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"outline_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_step_id" uuid,
	"started_by_clerk_user_id" text,
	"finished_at" timestamp with time zone,
	"last_turn_at" timestamp with time zone,
	"exchanges" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_interviews_status_valid" CHECK ("job_estimate_interviews"."status" in ('running', 'finished', 'abandoned')),
	CONSTRAINT "job_estimate_interviews_finished_has_date" CHECK (("job_estimate_interviews"."status" = 'running') = ("job_estimate_interviews"."finished_at" is null)),
	CONSTRAINT "job_estimate_interviews_exchanges_sane" CHECK ("job_estimate_interviews"."exchanges" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_interviews_tenant_id_id_idx" ON "job_estimate_interviews" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "job_estimate_interview_answers" ADD CONSTRAINT "job_estimate_interview_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_estimate_interview_answers" ADD CONSTRAINT "job_estimate_interview_answers_interview_fk" FOREIGN KEY ("tenant_id","interview_id") REFERENCES "public"."job_estimate_interviews"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD CONSTRAINT "job_estimate_interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD CONSTRAINT "job_estimate_interviews_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."job_estimates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" ADD CONSTRAINT "job_estimate_interviews_outline_fk" FOREIGN KEY ("tenant_id","outline_id") REFERENCES "public"."job_estimate_outlines"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_interview_answers_tenant_id_id_idx" ON "job_estimate_interview_answers" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "job_estimate_interview_answers_tenant_interview_idx" ON "job_estimate_interview_answers" USING btree ("tenant_id","interview_id","sort_order");
--> statement-breakpoint
CREATE INDEX "job_estimate_interviews_tenant_estimate_idx" ON "job_estimate_interviews" USING btree ("tenant_id","estimate_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_interviews_one_running_idx" ON "job_estimate_interviews" USING btree ("tenant_id","estimate_id") WHERE "job_estimate_interviews"."status" = 'running';
