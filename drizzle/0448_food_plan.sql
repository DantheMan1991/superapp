-- Food D2: the week (food_plan), and which planned meal an eaten row was
-- (food_eaten.plan_id). RLS is in 0449.
--
-- Hand-edited from drizzle-kit's output, as 0441 and 0446 were:
-- food_plan_tenant_id_id_idx is created BEFORE the two keys that point at it
-- (a leftover's cook, an eaten row's plan): a composite foreign key needs its
-- target's unique index to exist already. And food_eaten_plan_fk takes the
-- column-list form ON DELETE SET NULL ("plan_id"), as food_eaten_recipe_fk
-- does: a bare SET NULL would try to null tenant_id too and can never run on a
-- composite key. Clearing the week keeps what was eaten.
CREATE TYPE "public"."food_plan_kind" AS ENUM('cook', 'leftover', 'food');--> statement-breakpoint
CREATE TABLE "food_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"planned_on" date NOT NULL,
	"meal" "food_meal" NOT NULL,
	"kind" "food_plan_kind" NOT NULL,
	"recipe_id" uuid,
	"cook_id" uuid,
	"servings" double precision,
	"make" double precision,
	"fdc_id" integer,
	"name" text,
	"amount" double precision,
	"portion" text,
	"grams" double precision,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_plan_shape" CHECK (("food_plan"."kind" = 'cook' and "food_plan"."recipe_id" is not null and "food_plan"."cook_id" is null
          and "food_plan"."make" > 0 and "food_plan"."make" <= 999 and "food_plan"."servings" >= 0 and "food_plan"."servings" <= "food_plan"."make"
          and "food_plan"."fdc_id" is null and "food_plan"."name" is null and "food_plan"."amount" is null and "food_plan"."portion" is null and "food_plan"."grams" is null)
        or ("food_plan"."kind" = 'leftover' and "food_plan"."recipe_id" is null and "food_plan"."cook_id" is not null
          and "food_plan"."make" is null and "food_plan"."servings" > 0 and "food_plan"."servings" <= 999
          and "food_plan"."fdc_id" is null and "food_plan"."name" is null and "food_plan"."amount" is null and "food_plan"."portion" is null and "food_plan"."grams" is null)
        or ("food_plan"."kind" = 'food' and "food_plan"."recipe_id" is null and "food_plan"."cook_id" is null and "food_plan"."make" is null and "food_plan"."servings" is null
          and char_length("food_plan"."name") between 1 and 300 and "food_plan"."amount" > 0 and "food_plan"."amount" <= 100000
          and "food_plan"."portion" is not null and "food_plan"."grams" > 0))
);
--> statement-breakpoint
ALTER TABLE "food_eaten" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "food_plan" ADD CONSTRAINT "food_plan_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_plan" ADD CONSTRAINT "food_plan_fdc_id_food_usda_foods_fdc_id_fk" FOREIGN KEY ("fdc_id") REFERENCES "public"."food_usda_foods"("fdc_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_plan" ADD CONSTRAINT "food_plan_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."food_recipes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_plan_tenant_id_id_idx" ON "food_plan" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "food_plan" ADD CONSTRAINT "food_plan_cook_fk" FOREIGN KEY ("tenant_id","cook_id") REFERENCES "public"."food_plan"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_plan_tenant_day_idx" ON "food_plan" USING btree ("tenant_id","planned_on");--> statement-breakpoint
CREATE INDEX "food_plan_tenant_cook_idx" ON "food_plan" USING btree ("tenant_id","cook_id");--> statement-breakpoint
ALTER TABLE "food_eaten" ADD CONSTRAINT "food_eaten_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."food_plan"("tenant_id","id") ON DELETE SET NULL ("plan_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_eaten_plan_once_idx" ON "food_eaten" USING btree ("tenant_id","plan_id") WHERE "food_eaten"."plan_id" is not null;