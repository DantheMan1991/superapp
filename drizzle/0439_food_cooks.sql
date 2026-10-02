CREATE TABLE "food_cooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"made_on" date NOT NULL,
	"servings" double precision,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_cooks_servings_positive" CHECK ("food_cooks"."servings" is null or "food_cooks"."servings" > 0)
);
--> statement-breakpoint
ALTER TABLE "food_cooks" ADD CONSTRAINT "food_cooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_cooks" ADD CONSTRAINT "food_cooks_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."food_recipes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_cooks_tenant_recipe_idx" ON "food_cooks" USING btree ("tenant_id","recipe_id","made_on");