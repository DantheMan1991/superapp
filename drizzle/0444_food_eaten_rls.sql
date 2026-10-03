-- Food D4a: RLS on the three tables 0443 made, and the food list's search.
--
-- food_eaten and food_targets are ordinary tenant tables: the superadmin policy
-- for the god view and the member policy for the tenant's own rows, as every
-- personal tool's table (Food's 0438, Health's 0442).
--
-- food_usda_foods is REFERENCE DATA, the same in every space, with no
-- tenant_id: the `modules` table's two policies (0001). Any member reads it;
-- only the superadmin context (the seed) writes it.
ALTER TABLE "food_eaten" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_eaten" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_eaten_superadmin_all ON "food_eaten"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_eaten_member_all ON "food_eaten"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "food_targets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_targets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_targets_superadmin_all ON "food_targets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_targets_member_all ON "food_targets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "food_usda_foods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_usda_foods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_usda_foods_superadmin_all ON "food_usda_foods"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_usda_foods_authed_read ON "food_usda_foods" FOR SELECT
  USING (current_setting('app.role', true) IN ('member', 'superadmin'));
--> statement-breakpoint
-- The food list's search, as documents' (0026): a GENERATED STORED column, in
-- sync by construction, not modelled in src/db/schema (drizzle has no tsvector
-- type), queried with raw sql from src/modules/food/eating-ops.ts. The
-- `'english'::regconfig` cast is what makes the expression immutable, which a
-- generated column requires. The name weighs more than the category.
ALTER TABLE "food_usda_foods" ADD COLUMN "search_tsv" tsvector
GENERATED ALWAYS AS (
     setweight(to_tsvector('english'::regconfig, coalesce("name", '')), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce("category", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "food_usda_foods_search_idx" ON "food_usda_foods" USING gin ("search_tsv");
