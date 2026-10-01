-- Food (D1): RLS on the two tables 0437 made. Pattern per docs/security.md:
-- the superadmin policy for the god view, the member policy for the tenant's
-- own rows. These rows only ever exist in a PERSONAL space (ADR 0111), but
-- that is the module gate's business, not the database's: to RLS a personal
-- space is an ordinary tenant, and so are these tables.
ALTER TABLE "food_recipes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_recipes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_recipes_superadmin_all ON "food_recipes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_recipes_member_all ON "food_recipes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "food_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_imports_superadmin_all ON "food_imports"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_imports_member_all ON "food_imports"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
