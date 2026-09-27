-- Hand-reordered, as 0379 and 0389 were: drizzle emits every foreign key
-- before every index, and a composite foreign key onto (tenant_id, id) needs
-- the unique index it references to exist first. The five *_tenant_id_id_idx
-- indexes therefore come before the constraints; nothing else moved.
CREATE TYPE "public"."fitness_import_status" AS ENUM('drafting', 'draft', 'failed', 'saved', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."fitness_program_source" AS ENUM('imported', 'own');--> statement-breakpoint
CREATE TYPE "public"."fitness_unit" AS ENUM('reps', 'breaths', 'rolls', 'seconds');--> statement-breakpoint
CREATE TABLE "fitness_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"cues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit" "fitness_unit" DEFAULT 'reps' NOT NULL,
	"videos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_exercises_name_present" CHECK (length(btrim("fitness_exercises"."name")) > 0),
	CONSTRAINT "fitness_exercises_cues_array" CHECK (jsonb_typeof("fitness_exercises"."cues") = 'array'),
	CONSTRAINT "fitness_exercises_videos_array" CHECK (jsonb_typeof("fitness_exercises"."videos") = 'array')
);
--> statement-breakpoint
CREATE TABLE "fitness_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"page_count" integer NOT NULL,
	"link_count" integer DEFAULT 0 NOT NULL,
	"status" "fitness_import_status" DEFAULT 'drafting' NOT NULL,
	"draft" jsonb,
	"error" text,
	"program_id" uuid,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_imports_file_name_present" CHECK (length(btrim("fitness_imports"."file_name")) > 0),
	CONSTRAINT "fitness_imports_page_count_positive" CHECK ("fitness_imports"."page_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fitness_phase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phase_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"sets_min" integer DEFAULT 1 NOT NULL,
	"sets_max" integer,
	"target_min" integer NOT NULL,
	"target_max" integer,
	"per_side" boolean DEFAULT false NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_phase_items_position_nonnegative" CHECK ("fitness_phase_items"."position" >= 0),
	CONSTRAINT "fitness_phase_items_sets_range" CHECK ("fitness_phase_items"."sets_min" between 1 and 20 and ("fitness_phase_items"."sets_max" is null or "fitness_phase_items"."sets_max" between "fitness_phase_items"."sets_min" and 20)),
	CONSTRAINT "fitness_phase_items_target_range" CHECK ("fitness_phase_items"."target_min" between 1 and 1000 and ("fitness_phase_items"."target_max" is null or "fitness_phase_items"."target_max" between "fitness_phase_items"."target_min" and 1000))
);
--> statement-breakpoint
CREATE TABLE "fitness_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"min_done_days" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_phases_name_present" CHECK (length(btrim("fitness_phases"."name")) > 0),
	CONSTRAINT "fitness_phases_position_nonnegative" CHECK ("fitness_phases"."position" >= 0),
	CONSTRAINT "fitness_phases_min_done_days_positive" CHECK ("fitness_phases"."min_done_days" is null or "fitness_phases"."min_done_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "fitness_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"source" "fitness_program_source" DEFAULT 'own' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sessions_per_week_min" integer,
	"sessions_per_week_max" integer,
	"effort_min" integer,
	"effort_max" integer,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_programs_name_present" CHECK (length(btrim("fitness_programs"."name")) > 0),
	CONSTRAINT "fitness_programs_sessions_range" CHECK (("fitness_programs"."sessions_per_week_min" is null or "fitness_programs"."sessions_per_week_min" between 1 and 14)
        and ("fitness_programs"."sessions_per_week_max" is null or ("fitness_programs"."sessions_per_week_min" is not null and "fitness_programs"."sessions_per_week_max" between "fitness_programs"."sessions_per_week_min" and 14))),
	CONSTRAINT "fitness_programs_effort_range" CHECK (("fitness_programs"."effort_min" is null or "fitness_programs"."effort_min" between 1 and 10)
        and ("fitness_programs"."effort_max" is null or ("fitness_programs"."effort_min" is not null and "fitness_programs"."effort_max" between "fitness_programs"."effort_min" and 10)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_exercises_tenant_id_id_idx" ON "fitness_exercises" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_imports_tenant_id_id_idx" ON "fitness_imports" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_phase_items_tenant_id_id_idx" ON "fitness_phase_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_phases_tenant_id_id_idx" ON "fitness_phases" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_programs_tenant_id_id_idx" ON "fitness_programs" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "fitness_exercises" ADD CONSTRAINT "fitness_exercises_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_exercises" ADD CONSTRAINT "fitness_exercises_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."fitness_programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_imports" ADD CONSTRAINT "fitness_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_imports" ADD CONSTRAINT "fitness_imports_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."fitness_programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD CONSTRAINT "fitness_phase_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD CONSTRAINT "fitness_phase_items_phase_fk" FOREIGN KEY ("tenant_id","phase_id") REFERENCES "public"."fitness_phases"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD CONSTRAINT "fitness_phase_items_exercise_fk" FOREIGN KEY ("tenant_id","exercise_id") REFERENCES "public"."fitness_exercises"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_phases" ADD CONSTRAINT "fitness_phases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_phases" ADD CONSTRAINT "fitness_phases_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."fitness_programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_programs" ADD CONSTRAINT "fitness_programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fitness_exercises_tenant_program_idx" ON "fitness_exercises" USING btree ("tenant_id","program_id");--> statement-breakpoint
CREATE INDEX "fitness_imports_tenant_created_idx" ON "fitness_imports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "fitness_phase_items_tenant_phase_position_idx" ON "fitness_phase_items" USING btree ("tenant_id","phase_id","position");--> statement-breakpoint
CREATE INDEX "fitness_phase_items_tenant_exercise_idx" ON "fitness_phase_items" USING btree ("tenant_id","exercise_id");--> statement-breakpoint
CREATE INDEX "fitness_phases_tenant_program_position_idx" ON "fitness_phases" USING btree ("tenant_id","program_id","position");--> statement-breakpoint
CREATE INDEX "fitness_programs_tenant_created_idx" ON "fitness_programs" USING btree ("tenant_id","created_at");