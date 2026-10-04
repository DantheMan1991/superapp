-- Food D3: the shopping list's two tables. food_line_names keeps what each
-- ingredient line (or planned food) buys, a row a thing (a line may buy two:
-- "Salt and pepper to taste"), its aisle and whether most kitchens keep it,
-- named once per space by Claude; food_staples the things the person always
-- has. Ticks and their own items are kept on the phone, not here. RLS is in
-- 0451.
CREATE TYPE "public"."food_aisle" AS ENUM('produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'drinks', 'other');--> statement-breakpoint
CREATE TABLE "food_line_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"line" text NOT NULL,
	"item" text,
	"aisle" "food_aisle" NOT NULL,
	"staple" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_line_names_tenant_line_item_key" UNIQUE NULLS NOT DISTINCT("tenant_id","line","item"),
	CONSTRAINT "food_line_names_line_length" CHECK (char_length("food_line_names"."line") between 1 and 500),
	CONSTRAINT "food_line_names_item_length" CHECK ("food_line_names"."item" is null or char_length("food_line_names"."item") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "food_staples" (
	"tenant_id" uuid NOT NULL,
	"item" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_staples_tenant_id_item_pk" PRIMARY KEY("tenant_id","item"),
	CONSTRAINT "food_staples_item_length" CHECK (char_length("food_staples"."item") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "food_line_names" ADD CONSTRAINT "food_line_names_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_staples" ADD CONSTRAINT "food_staples_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;