-- Posture check, slice 3 (history): RLS on the table 0434 made. The same
-- pattern as the other Workouts tables (0427, 0429, 0431): the superadmin
-- policy for the god view, the member policy for the tenant's own rows. A
-- personal space is an ordinary tenant to RLS (ADR 0111), and support view
-- never opens one. The rows are numbers only (ADR 0118): no picture of a
-- person is ever in this table.
ALTER TABLE "fitness_posture_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_posture_checks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_posture_checks_superadmin_all ON "fitness_posture_checks"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_posture_checks_member_all ON "fitness_posture_checks"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
