-- Food D3: RLS on the shopping list's two tables, the same two policies as every
-- personal tool's table (Food's 0444 and 0449): the superadmin policy for the
-- god view, the member policy for the tenant's own rows.
ALTER TABLE "food_line_names" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_line_names" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_line_names_superadmin_all ON "food_line_names"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_line_names_member_all ON "food_line_names"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "food_staples" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_staples" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_staples_superadmin_all ON "food_staples"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_staples_member_all ON "food_staples"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
