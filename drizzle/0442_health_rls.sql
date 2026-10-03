-- Health (H1): RLS on the four tables 0441 made, the same two policies as every
-- personal tool's table (Food's 0438): the superadmin policy for the god view,
-- the member policy for the tenant's own rows. A personal space is an ordinary
-- tenant to RLS.
ALTER TABLE "health_plunges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_plunges" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_plunges_superadmin_all ON "health_plunges"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_plunges_member_all ON "health_plunges"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_sleep" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_sleep" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_sleep_superadmin_all ON "health_sleep"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_sleep_member_all ON "health_sleep"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_habits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_habits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_habits_superadmin_all ON "health_habits"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_habits_member_all ON "health_habits"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_habit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_habit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_habit_logs_superadmin_all ON "health_habit_logs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_habit_logs_member_all ON "health_habit_logs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
