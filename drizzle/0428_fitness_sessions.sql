-- Workouts F2a (workout mode): following a program, its sessions, the exercises
-- done in each, and their sets; and the program's breathing pace.
--
-- Hand-edited, as 0426 was, in two ways:
--   1. The four (tenant_id, id) unique indexes come before the composite foreign
--      keys that reference them; drizzle emits every foreign key first.
--   2. The three keys from a log to the program it logged are the column-list
--      form, ON DELETE SET NULL ("x"): a bare SET NULL would try to null
--      tenant_id too and can never run on a composite key. The schema declares
--      .onDelete("set null") and the snapshot records the same, so db:generate
--      does not re-emit them.
CREATE TYPE "public"."fitness_hurt" AS ENUM('none', 'pinch', 'yes');
--> statement-breakpoint
CREATE TYPE "public"."fitness_side" AS ENUM('left', 'right');
--> statement-breakpoint
CREATE TABLE "fitness_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"side" "fitness_side",
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness_session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"item_id" uuid,
	"exercise_id" uuid,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"unit" "fitness_unit" NOT NULL,
	"per_side" boolean DEFAULT false NOT NULL,
	"effort" integer,
	"cues_felt" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hurt" "fitness_hurt",
	"hurt_note" text DEFAULT '' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_session_exercises_position_nonnegative" CHECK ("fitness_session_exercises"."position" >= 0),
	CONSTRAINT "fitness_session_exercises_effort_range" CHECK ("fitness_session_exercises"."effort" is null or "fitness_session_exercises"."effort" between 1 and 10),
	CONSTRAINT "fitness_session_exercises_cues_array" CHECK (jsonb_typeof("fitness_session_exercises"."cues_felt") = 'array')
);
--> statement-breakpoint
CREATE TABLE "fitness_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"phase_id" uuid,
	"phase_name" text DEFAULT '' NOT NULL,
	"local_day" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"feel_before" integer,
	"feel_after" integer,
	"note" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_sessions_feel_before_range" CHECK ("fitness_sessions"."feel_before" is null or "fitness_sessions"."feel_before" between 0 and 10),
	CONSTRAINT "fitness_sessions_feel_after_range" CHECK ("fitness_sessions"."feel_after" is null or "fitness_sessions"."feel_after" between 0 and 10),
	CONSTRAINT "fitness_sessions_revision_positive" CHECK ("fitness_sessions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fitness_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"side" "fitness_side",
	"target" integer NOT NULL,
	"count" integer NOT NULL,
	"done_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_sets_number_range" CHECK ("fitness_sets"."number" between 1 and 20),
	CONSTRAINT "fitness_sets_target_range" CHECK ("fitness_sets"."target" between 1 and 1000),
	CONSTRAINT "fitness_sets_count_range" CHECK ("fitness_sets"."count" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "fitness_programs" ADD COLUMN "breath_out_s" integer;
--> statement-breakpoint
ALTER TABLE "fitness_programs" ADD COLUMN "breath_in_s" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_enrollments_tenant_id_id_idx" ON "fitness_enrollments" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_session_exercises_tenant_id_id_idx" ON "fitness_session_exercises" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_sessions_tenant_id_id_idx" ON "fitness_sessions" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_sets_tenant_id_id_idx" ON "fitness_sets" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "fitness_enrollments" ADD CONSTRAINT "fitness_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_enrollments" ADD CONSTRAINT "fitness_enrollments_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."fitness_programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD CONSTRAINT "fitness_session_exercises_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD CONSTRAINT "fitness_session_exercises_session_fk" FOREIGN KEY ("tenant_id","session_id") REFERENCES "public"."fitness_sessions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD CONSTRAINT "fitness_session_exercises_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."fitness_phase_items"("tenant_id","id") ON DELETE SET NULL ("item_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD CONSTRAINT "fitness_session_exercises_exercise_fk" FOREIGN KEY ("tenant_id","exercise_id") REFERENCES "public"."fitness_exercises"("tenant_id","id") ON DELETE SET NULL ("exercise_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_sessions" ADD CONSTRAINT "fitness_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_sessions" ADD CONSTRAINT "fitness_sessions_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."fitness_enrollments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_sessions" ADD CONSTRAINT "fitness_sessions_phase_fk" FOREIGN KEY ("tenant_id","phase_id") REFERENCES "public"."fitness_phases"("tenant_id","id") ON DELETE SET NULL ("phase_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_sets" ADD CONSTRAINT "fitness_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fitness_sets" ADD CONSTRAINT "fitness_sets_session_exercise_fk" FOREIGN KEY ("tenant_id","session_exercise_id") REFERENCES "public"."fitness_session_exercises"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_enrollments_open_idx" ON "fitness_enrollments" USING btree ("tenant_id","program_id") WHERE "fitness_enrollments"."ended_at" is null;
--> statement-breakpoint
CREATE INDEX "fitness_session_exercises_tenant_session_idx" ON "fitness_session_exercises" USING btree ("tenant_id","session_id");
--> statement-breakpoint
CREATE INDEX "fitness_session_exercises_tenant_item_idx" ON "fitness_session_exercises" USING btree ("tenant_id","item_id");
--> statement-breakpoint
CREATE INDEX "fitness_sessions_tenant_enrollment_day_idx" ON "fitness_sessions" USING btree ("tenant_id","enrollment_id","local_day");
--> statement-breakpoint
CREATE INDEX "fitness_sets_tenant_session_exercise_idx" ON "fitness_sets" USING btree ("tenant_id","session_exercise_id");
--> statement-breakpoint
ALTER TABLE "fitness_programs" ADD CONSTRAINT "fitness_programs_breath_pace" CHECK (("fitness_programs"."breath_out_s" is null or "fitness_programs"."breath_out_s" between 1 and 30)
        and ("fitness_programs"."breath_in_s" is null or "fitness_programs"."breath_in_s" between 1 and 30));
