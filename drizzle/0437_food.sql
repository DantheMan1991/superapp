CREATE TYPE "public"."food_import_kind" AS ENUM('link', 'text', 'photo');--> statement-breakpoint
CREATE TYPE "public"."food_import_status" AS ENUM('reading', 'draft', 'failed');--> statement-breakpoint
CREATE TABLE "food_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "food_import_kind" NOT NULL,
	"source_url" text,
	"status" "food_import_status" DEFAULT 'reading' NOT NULL,
	"draft" jsonb,
	"error" text,
	"photo_pathname" text,
	"photo_width" integer,
	"photo_height" integer,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_imports_link_has_url" CHECK ("food_imports"."kind" <> 'link' or "food_imports"."source_url" is not null),
	CONSTRAINT "food_imports_photo_whole" CHECK (("food_imports"."photo_pathname" is null) = ("food_imports"."photo_width" is null)
        and ("food_imports"."photo_pathname" is null) = ("food_imports"."photo_height" is null))
);
--> statement-breakpoint
CREATE TABLE "food_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"yield_amount" double precision,
	"yield_unit" text,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"total_minutes" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"nutrition" jsonb,
	"source_url" text,
	"photo_pathname" text,
	"photo_width" integer,
	"photo_height" integer,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_recipes_title_present" CHECK (length(btrim("food_recipes"."title")) > 0),
	CONSTRAINT "food_recipes_yield_positive" CHECK ("food_recipes"."yield_amount" is null or "food_recipes"."yield_amount" > 0),
	CONSTRAINT "food_recipes_minutes_range" CHECK (("food_recipes"."prep_minutes" is null or "food_recipes"."prep_minutes" between 0 and 10080)
        and ("food_recipes"."cook_minutes" is null or "food_recipes"."cook_minutes" between 0 and 10080)
        and ("food_recipes"."total_minutes" is null or "food_recipes"."total_minutes" between 0 and 10080)),
	CONSTRAINT "food_recipes_photo_whole" CHECK (("food_recipes"."photo_pathname" is null) = ("food_recipes"."photo_width" is null)
        and ("food_recipes"."photo_pathname" is null) = ("food_recipes"."photo_height" is null))
);
--> statement-breakpoint
ALTER TABLE "food_imports" ADD CONSTRAINT "food_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_recipes" ADD CONSTRAINT "food_recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_imports_tenant_id_id_idx" ON "food_imports" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "food_imports_tenant_created_idx" ON "food_imports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "food_recipes_tenant_id_id_idx" ON "food_recipes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "food_recipes_tenant_updated_idx" ON "food_recipes" USING btree ("tenant_id","updated_at");