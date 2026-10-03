-- Health (H2): RLS on the four tables 0446 made, the same two policies as every
-- personal tool's table (Health's 0442): the superadmin policy for the god view,
-- the member policy for the tenant's own rows. A personal space is an ordinary
-- tenant to RLS.
ALTER TABLE "health_weighins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_weighins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_weighins_superadmin_all ON "health_weighins"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_weighins_member_all ON "health_weighins"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_weight_goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_weight_goals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_weight_goals_superadmin_all ON "health_weight_goals"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_weight_goals_member_all ON "health_weight_goals"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_measures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_measures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_measures_superadmin_all ON "health_measures"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_measures_member_all ON "health_measures"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "health_measurements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_measurements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_measurements_superadmin_all ON "health_measurements"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY health_measurements_member_all ON "health_measurements"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
