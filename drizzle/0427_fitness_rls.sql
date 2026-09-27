-- Workouts (fitness, F1): RLS on the five tables 0426 made. Pattern per
-- docs/security.md: the superadmin policy for the god view, the member policy
-- for the tenant's own rows. These rows only ever exist in a PERSONAL space
-- (ADR 0111), but that is the module gate's business, not the database's —
-- to RLS a personal space is an ordinary tenant, and so are these tables.
ALTER TABLE "fitness_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_programs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_programs_superadmin_all ON "fitness_programs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_programs_member_all ON "fitness_programs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_phases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_phases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_phases_superadmin_all ON "fitness_phases"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_phases_member_all ON "fitness_phases"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_exercises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_exercises" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_exercises_superadmin_all ON "fitness_exercises"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_exercises_member_all ON "fitness_exercises"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_phase_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_phase_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_phase_items_superadmin_all ON "fitness_phase_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_phase_items_member_all ON "fitness_phase_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_imports_superadmin_all ON "fitness_imports"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_imports_member_all ON "fitness_imports"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
