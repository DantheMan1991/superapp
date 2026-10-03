-- Food D4a: what was eaten (food_eaten), the daily targets (food_targets) and
-- USDA's survey foods the log searches (food_usda_foods). RLS, and the food
-- list's search column, are in 0444.
--
-- food_eaten_recipe_fk is hand-edited to the column-list form
-- ON DELETE SET NULL ("recipe_id"): a bare SET NULL would try to null tenant_id
-- too and can never run on a composite key. Deleting a recipe keeps what was
-- eaten, with its name and numbers.
CREATE TYPE "public"."food_eaten_source" AS ENUM('food', 'recipe', 'photo');--> statement-breakpoint
CREATE TYPE "public"."food_meal" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TABLE "food_eaten" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"eaten_on" date NOT NULL,
	"meal" "food_meal" NOT NULL,
	"source" "food_eaten_source" NOT NULL,
	"fdc_id" integer,
	"recipe_id" uuid,
	"name" text NOT NULL,
	"amount" double precision NOT NULL,
	"portion" text NOT NULL,
	"grams" double precision,
	"calories" double precision,
	"protein_g" double precision,
	"carbs_g" double precision,
	"fat_g" double precision,
	"fiber_g" double precision,
	"sugar_g" double precision,
	"sodium_mg" double precision,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_eaten_amount_range" CHECK ("food_eaten"."amount" > 0 and "food_eaten"."amount" <= 100000),
	CONSTRAINT "food_eaten_grams_for_foods" CHECK (("food_eaten"."source" = 'recipe') = ("food_eaten"."grams" is null)),
	CONSTRAINT "food_eaten_grams_positive" CHECK ("food_eaten"."grams" is null or "food_eaten"."grams" > 0),
	CONSTRAINT "food_eaten_name_length" CHECK (char_length("food_eaten"."name") between 1 and 300),
	CONSTRAINT "food_eaten_nutrients_positive" CHECK (coalesce("food_eaten"."calories", 0) >= 0 and coalesce("food_eaten"."protein_g", 0) >= 0 and coalesce("food_eaten"."carbs_g", 0) >= 0
        and coalesce("food_eaten"."fat_g", 0) >= 0 and coalesce("food_eaten"."fiber_g", 0) >= 0 and coalesce("food_eaten"."sugar_g", 0) >= 0
        and coalesce("food_eaten"."sodium_mg", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_targets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"calories" integer,
	"protein_g" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_targets_calories_range" CHECK ("food_targets"."calories" is null or "food_targets"."calories" between 500 and 10000),
	CONSTRAINT "food_targets_protein_range" CHECK ("food_targets"."protein_g" is null or "food_targets"."protein_g" between 10 and 500)
);
--> statement-breakpoint
CREATE TABLE "food_usda_foods" (
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
	CONSTRAINT "food_usda_foods_nutrients_positive" CHECK ("food_usda_foods"."calories" >= 0 and "food_usda_foods"."protein_g" >= 0 and "food_usda_foods"."carbs_g" >= 0 and "food_usda_foods"."fat_g" >= 0
        and "food_usda_foods"."fiber_g" >= 0 and "food_usda_foods"."sugar_g" >= 0 and "food_usda_foods"."sodium_mg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "food_eaten" ADD CONSTRAINT "food_eaten_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_eaten" ADD CONSTRAINT "food_eaten_fdc_id_food_usda_foods_fdc_id_fk" FOREIGN KEY ("fdc_id") REFERENCES "public"."food_usda_foods"("fdc_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_eaten" ADD CONSTRAINT "food_eaten_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."food_recipes"("tenant_id","id") ON DELETE SET NULL ("recipe_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_targets" ADD CONSTRAINT "food_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_eaten_tenant_day_idx" ON "food_eaten" USING btree ("tenant_id","eaten_on");