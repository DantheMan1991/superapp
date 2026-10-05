-- Food D4: RLS on the ingredient list, and its search.
--
-- food_usda_ingredients is REFERENCE DATA, the same in every space, with no
-- tenant_id: the `modules` table's two policies (0001), as food_usda_foods has
-- (0444). Any member reads it; only the superadmin context (the seed) writes it.
-- food_recipes' new worked_nutrition column rides on food_recipes' own
-- policies (0438).
ALTER TABLE "food_usda_ingredients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_usda_ingredients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_usda_ingredients_superadmin_all ON "food_usda_ingredients"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY food_usda_ingredients_authed_read ON "food_usda_ingredients" FOR SELECT
  USING (current_setting('app.role', true) IN ('member', 'superadmin'));
--> statement-breakpoint
-- The ingredient list's search, as the food list's (0444): a GENERATED STORED
-- column, not modelled in src/db/schema (drizzle has no tsvector type), queried
-- with raw sql by searchUsda in src/modules/food/eating-ops.ts. The name weighs more
-- than the category.
ALTER TABLE "food_usda_ingredients" ADD COLUMN "search_tsv" tsvector
GENERATED ALWAYS AS (
     setweight(to_tsvector('english'::regconfig, coalesce("name", '')), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce("category", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "food_usda_ingredients_search_idx" ON "food_usda_ingredients" USING gin ("search_tsv");
