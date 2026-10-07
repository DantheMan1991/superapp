-- Food D4: the ingredient list a recipe's nutrition is worked out from
-- (food_usda_ingredients, USDA's SR Legacy, loaded by the seed), and the
-- worked-out nutrition on each recipe (food_recipes.worked_nutrition). RLS and
-- the list's search are in 0453.
CREATE TABLE "food_usda_ingredients" (
	"fdc_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"calories" double precision NOT NULL,
	"protein_g" double precision NOT NULL,
	"carbs_g" double precision NOT NULL,
	"fat_g" double precision NOT NULL,
	"fiber_g" double precision NOT NULL,
	"sugar_g" double precision NOT NULL,
	"sodium_mg" double precision NOT NULL,
	"portions" jsonb NOT NULL,
	"release" text NOT NULL,
	CONSTRAINT "food_usda_ingredients_nutrients_positive" CHECK ("food_usda_ingredients"."calories" >= 0 and "food_usda_ingredients"."protein_g" >= 0 and "food_usda_ingredients"."carbs_g" >= 0 and "food_usda_ingredients"."fat_g" >= 0
        and "food_usda_ingredients"."fiber_g" >= 0 and "food_usda_ingredients"."sugar_g" >= 0 and "food_usda_ingredients"."sodium_mg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "food_recipes" ADD COLUMN "worked_nutrition" jsonb;