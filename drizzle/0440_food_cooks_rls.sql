-- Food (D1b): RLS on the table 0439 made, the same two policies as every Food
-- table (0438): the superadmin policy for the god view, the member policy for
-- the tenant's own rows. A personal space is an ordinary tenant to RLS.
ALTER TABLE "food_cooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_cooks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_cooks_superadmin_all ON "food_cooks"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_cooks_member_all ON "food_cooks"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
