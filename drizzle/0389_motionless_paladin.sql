-- Estimate outlines: the order a business prices a job in, and what it asks
-- itself at each stop (X1, ADR 0098).
--
-- HAND-REORDERED, and it would not run otherwise. drizzle generated every
-- foreign key before every index, so `job_estimate_outline_steps_outline_fk`
-- and `job_estimate_outline_questions_step_fk` — which reference their
-- parent's (tenant_id, id) — landed before the unique indexes that make those
-- columns a legal target. Postgres refuses a composite FK with no unique
-- constraint behind it, so both parents' unique indexes are moved ahead of the
-- children's keys here, exactly as 0379, 0356 and 0352 had to be.

CREATE TABLE "job_estimate_outlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_outlines_name_present" CHECK (length(btrim("job_estimate_outlines"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "job_estimate_outline_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outline_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"cost_code" text DEFAULT '' NOT NULL,
	"guidance" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_outline_steps_title_present" CHECK (length(btrim("job_estimate_outline_steps"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "job_estimate_outline_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"prompt" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_outline_questions_prompt_present" CHECK (length(btrim("job_estimate_outline_questions"."prompt")) > 0),
	CONSTRAINT "job_estimate_outline_questions_kind_valid" CHECK ("job_estimate_outline_questions"."kind" in ('choice', 'yes_no', 'number', 'money', 'text')),
	CONSTRAINT "job_estimate_outline_questions_choices_match_kind" CHECK (jsonb_typeof("job_estimate_outline_questions"."choices") = 'array' and (
        case when "job_estimate_outline_questions"."kind" = 'choice'
          then jsonb_array_length("job_estimate_outline_questions"."choices") >= 2
          else jsonb_array_length("job_estimate_outline_questions"."choices") = 0
        end
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outlines_tenant_id_id_idx" ON "job_estimate_outlines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outline_steps_tenant_id_id_idx" ON "job_estimate_outline_steps" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_estimate_outlines" ADD CONSTRAINT "job_estimate_outlines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_outline_steps" ADD CONSTRAINT "job_estimate_outline_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_outline_steps" ADD CONSTRAINT "job_estimate_outline_steps_outline_fk" FOREIGN KEY ("tenant_id","outline_id") REFERENCES "public"."job_estimate_outlines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_outline_questions" ADD CONSTRAINT "job_estimate_outline_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_outline_questions" ADD CONSTRAINT "job_estimate_outline_questions_step_fk" FOREIGN KEY ("tenant_id","step_id") REFERENCES "public"."job_estimate_outline_steps"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outline_questions_tenant_id_id_idx" ON "job_estimate_outline_questions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_estimate_outline_questions_tenant_step_sort_idx" ON "job_estimate_outline_questions" USING btree ("tenant_id","step_id","sort_order");--> statement-breakpoint
CREATE INDEX "job_estimate_outline_steps_tenant_outline_sort_idx" ON "job_estimate_outline_steps" USING btree ("tenant_id","outline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outlines_tenant_name_idx" ON "job_estimate_outlines" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outlines_one_default_idx" ON "job_estimate_outlines" USING btree ("tenant_id") WHERE "job_estimate_outlines"."is_default";
