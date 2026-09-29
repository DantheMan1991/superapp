CREATE TYPE "public"."fitness_side_means" AS ENUM('side', 'lying', 'top_leg');--> statement-breakpoint
CREATE TYPE "public"."fitness_side_rule" AS ENUM('both', 'toward', 'away');--> statement-breakpoint
ALTER TABLE "fitness_enrollments" ADD COLUMN "side_answers" jsonb;--> statement-breakpoint
ALTER TABLE "fitness_enrollments" ADD COLUMN "side_assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD COLUMN "side_rule" "fitness_side_rule" DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD COLUMN "side_means" "fitness_side_means" DEFAULT 'side' NOT NULL;--> statement-breakpoint
ALTER TABLE "fitness_programs" ADD COLUMN "assessment" jsonb;--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ADD CONSTRAINT "fitness_phase_items_side_rule_per_side" CHECK ("fitness_phase_items"."side_rule" = 'both' or "fitness_phase_items"."per_side");