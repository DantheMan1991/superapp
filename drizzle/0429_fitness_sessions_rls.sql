-- Workouts F2a (workout mode): RLS on the four tables 0428 made. The same
-- pattern as 0427: the superadmin policy for the god view, the member policy
-- for the tenant's own rows. A personal space is an ordinary tenant to RLS.
ALTER TABLE "fitness_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_enrollments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_enrollments_superadmin_all ON "fitness_enrollments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_enrollments_member_all ON "fitness_enrollments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_sessions_superadmin_all ON "fitness_sessions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_sessions_member_all ON "fitness_sessions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_session_exercises" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_session_exercises_superadmin_all ON "fitness_session_exercises"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_session_exercises_member_all ON "fitness_session_exercises"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "fitness_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_sets_superadmin_all ON "fitness_sets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_sets_member_all ON "fitness_sets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
