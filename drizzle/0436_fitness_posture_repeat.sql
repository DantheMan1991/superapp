ALTER TABLE "fitness_posture_checks" ADD COLUMN "repeat_of" uuid;--> statement-breakpoint
-- Hand-edited from drizzle's `ON DELETE set null`: the column-list form nulls
-- only repeat_of when the repeated check is deleted. A bare SET NULL would null
-- tenant_id too, which is NOT NULL, so it could never run (PG 15+).
ALTER TABLE "fitness_posture_checks" ADD CONSTRAINT "fitness_posture_checks_repeat_fk" FOREIGN KEY ("tenant_id","repeat_of") REFERENCES "public"."fitness_posture_checks"("tenant_id","id") ON DELETE SET NULL ("repeat_of") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_posture_checks" ADD CONSTRAINT "fitness_posture_checks_repeat_not_self" CHECK ("fitness_posture_checks"."repeat_of" is null or "fitness_posture_checks"."repeat_of" <> "fitness_posture_checks"."id");