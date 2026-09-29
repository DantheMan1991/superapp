ALTER TABLE "fitness_enrollments" ADD COLUMN "levels" jsonb;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD COLUMN "progression" jsonb;--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD COLUMN "level_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ADD CONSTRAINT "fitness_session_exercises_level_range" CHECK ("fitness_session_exercises"."level" is null or "fitness_session_exercises"."level" between 0 and 19);