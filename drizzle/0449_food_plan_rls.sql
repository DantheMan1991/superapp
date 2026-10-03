-- Food D2: RLS on the week (food_plan), the same two policies as every personal
-- tool's table (Food's 0444, Health's 0447): the superadmin policy for the god
-- view, the member policy for the tenant's own rows. food_eaten's new plan_id
-- column rides on food_eaten's own policies (0444).
ALTER TABLE "food_plan" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_plan" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_plan_superadmin_all ON "food_plan"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_plan_member_all ON "food_plan"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
