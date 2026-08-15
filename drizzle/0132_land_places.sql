-- land: parcels, zones, and dated zone use. Slice 0 of the `land` pack.
--
-- HAND-REORDERED FROM THE GENERATED OUTPUT, for the third time in this repo.
-- drizzle-kit emits EVERY foreign key before EVERY index, and both composite
-- FKs here (`land_zones_parcel_fk`, `land_zone_uses_zone_fk`) target a unique
-- index created in THIS migration, so the generated order fails with
--   there is no unique constraint matching given keys for referenced table
-- Cross-table FKs to a PRE-EXISTING table are fine — which is why this only
-- bites when the target table is new too, and why it caught 0125 and 0130
-- before this one.
--
-- THE ORDER THAT WORKS, and the one every future pack migration should be
-- checked against: tables → unique indexes → foreign keys → everything else.

CREATE TABLE "land_parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tenure" text DEFAULT 'owned' NOT NULL,
	"area_acres" numeric(12, 4),
	"identifier" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_parcels_name_present" CHECK (length(btrim("land_parcels"."name")) > 0),
	CONSTRAINT "land_parcels_tenure_valid" CHECK ("land_parcels"."tenure" in ('owned', 'leased', 'crop_share')),
	CONSTRAINT "land_parcels_status_valid" CHECK ("land_parcels"."status" in ('active', 'retired')),
	CONSTRAINT "land_parcels_area_positive" CHECK ("land_parcels"."area_acres" is null or "land_parcels"."area_acres" > 0)
);
--> statement-breakpoint
CREATE TABLE "land_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"area_acres" numeric(12, 4),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_zones_name_present" CHECK (length(btrim("land_zones"."name")) > 0),
	CONSTRAINT "land_zones_status_valid" CHECK ("land_zones"."status" in ('active', 'retired')),
	CONSTRAINT "land_zones_area_positive" CHECK ("land_zones"."area_acres" is null or "land_zones"."area_acres" > 0)
);
--> statement-breakpoint
CREATE TABLE "land_zone_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"use" text NOT NULL,
	"is_productive" boolean DEFAULT true NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_zone_uses_use_format" CHECK ("land_zone_uses"."use" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "land_zone_uses_range_ordered" CHECK ("land_zone_uses"."ended_on" is null or "land_zone_uses"."ended_on" >= "land_zone_uses"."started_on")
);
--> statement-breakpoint

-- Unique indexes BEFORE the composite FKs that reference them.
CREATE UNIQUE INDEX "land_parcels_tenant_id_id_idx" ON "land_parcels" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "land_zones_tenant_id_id_idx" ON "land_zones" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "land_zone_uses_tenant_id_id_idx" ON "land_zone_uses" USING btree ("tenant_id","id");--> statement-breakpoint

ALTER TABLE "land_parcels" ADD CONSTRAINT "land_parcels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_zones" ADD CONSTRAINT "land_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_zone_uses" ADD CONSTRAINT "land_zone_uses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Composite, so a zone is always inside a same-tenant parcel and a use always
-- belongs to a same-tenant zone. Cross-tenant nesting is unrepresentable, not
-- merely prevented in application code.
--
-- RESTRICT on the parcel (no ON DELETE clause): a composite FK's SET NULL would
-- null `tenant_id` too, and CASCADE would let deleting a parcel silently take
-- its paddocks and their whole use history with it.
ALTER TABLE "land_zones" ADD CONSTRAINT "land_zones_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "public"."land_parcels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- CASCADE here, unlike above: a use has no meaning without its zone.
ALTER TABLE "land_zone_uses" ADD CONSTRAINT "land_zone_uses_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."land_zones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "land_parcels_tenant_status_idx" ON "land_parcels" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "land_zones_tenant_parcel_idx" ON "land_zones" USING btree ("tenant_id","parcel_id");--> statement-breakpoint
CREATE INDEX "land_zones_tenant_status_idx" ON "land_zones" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "land_zone_uses_tenant_zone_idx" ON "land_zone_uses" USING btree ("tenant_id","zone_id","started_on");
