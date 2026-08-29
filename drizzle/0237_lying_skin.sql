-- land_plans + land_plan_items, and `plan_id` on a feature (slice 2b.4).
--
-- A PLAN is a named set of proposals and the materials list taken off them. It
-- has no status column: its features already carry planned/built/removed, so
-- "is this plan built" is derivable, and a second status is a second thing that
-- can be wrong.
--
-- HAND-REORDERED, THE SAME TRAP AS drizzle/0233. Composite FKs need a unique
-- index on the referenced columns to exist BEFORE the constraint is added, and
-- drizzle-kit emits every FK first and every index after. That is correct for a
-- reference to a table created in an earlier migration and fails with "there is
-- no unique constraint matching given keys" for one created in this file — here,
-- `land_plan_items_plan_fk` pointing at `land_plans`. Both unique indexes are
-- therefore created immediately after their tables.

CREATE TABLE "land_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"taken_off_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_plans_name_present" CHECK (length(btrim("land_plans"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "land_plans_tenant_id_id_idx" ON "land_plans" USING btree ("tenant_id","id");--> statement-breakpoint

CREATE TABLE "land_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"source_feature_id" uuid,
	"material" text NOT NULL,
	"label" text NOT NULL,
	"quantity" numeric(14, 2) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(14, 4),
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_plan_items_material_format" CHECK ("land_plan_items"."material" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "land_plan_items_unit_valid" CHECK ("land_plan_items"."unit" in ('each', 'ft', 'm')),
	CONSTRAINT "land_plan_items_quantity_positive" CHECK ("land_plan_items"."quantity" > 0),
	CONSTRAINT "land_plan_items_unit_cost_positive" CHECK ("land_plan_items"."unit_cost" is null or "land_plan_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "land_plan_items_tenant_id_id_idx" ON "land_plan_items" USING btree ("tenant_id","id");--> statement-breakpoint

ALTER TABLE "land_features" ADD COLUMN "plan_id" uuid;--> statement-breakpoint

ALTER TABLE "land_plans" ADD CONSTRAINT "land_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_plans" ADD CONSTRAINT "land_plans_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "public"."land_parcels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_plan_items" ADD CONSTRAINT "land_plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_plan_items" ADD CONSTRAINT "land_plan_items_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."land_plans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_plan_items" ADD CONSTRAINT "land_plan_items_source_fk" FOREIGN KEY ("tenant_id","source_feature_id") REFERENCES "public"."land_features"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_features" ADD CONSTRAINT "land_features_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."land_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "land_plan_items_tenant_plan_idx" ON "land_plan_items" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE INDEX "land_plan_items_tenant_source_idx" ON "land_plan_items" USING btree ("tenant_id","source_feature_id");--> statement-breakpoint
CREATE INDEX "land_plans_tenant_parcel_idx" ON "land_plans" USING btree ("tenant_id","parcel_id");--> statement-breakpoint
CREATE INDEX "land_features_tenant_plan_idx" ON "land_features" USING btree ("tenant_id","plan_id");
