-- land: occupancy, and a rest target to compare against. Slice 1 of `land`.
--
-- NOT REORDERED, and that is deliberate rather than an oversight. drizzle-kit
-- emits every FK before every index, which broke 0125, 0130 and 0132 — but only
-- because those composite FKs pointed at a unique index created in the SAME
-- migration. `land_occupancy_zone_fk` targets `land_zones (tenant_id, id)`,
-- whose unique index has existed since 0132, so the generated order is correct
-- here. The rule is "check the target is pre-existing", not "always reorder".
--
-- `rest_target_days` is a COMPARISON LINE, not a setting. Nothing schedules
-- against it, nothing nags, and no write path consults it. It lives on the
-- parcel because the rest clock is discontinuous across a seasonal migration:
-- a wintering parcel resting 100+ days and a summer parcel on an 11-day cycle
-- are both correct, and one farm-wide number would flag one of them wrong on
-- every screen it appeared on.

CREATE TABLE "land_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"extension_slug" text DEFAULT 'land' NOT NULL,
	"occupant_type" text DEFAULT 'manual' NOT NULL,
	"occupant_id" uuid,
	"occupant_label" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"area_acres" numeric(12, 4),
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_occupancy_occupant_type_format" CHECK ("land_occupancy"."occupant_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "land_occupancy_label_present" CHECK (length(btrim("land_occupancy"."occupant_label")) > 0),
	CONSTRAINT "land_occupancy_range_ordered" CHECK ("land_occupancy"."ended_on" is null or "land_occupancy"."ended_on" >= "land_occupancy"."started_on"),
	CONSTRAINT "land_occupancy_area_positive" CHECK ("land_occupancy"."area_acres" is null or "land_occupancy"."area_acres" > 0)
);
--> statement-breakpoint
ALTER TABLE "land_parcels" ADD COLUMN "rest_target_days" integer;--> statement-breakpoint
ALTER TABLE "land_occupancy" ADD CONSTRAINT "land_occupancy_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_occupancy" ADD CONSTRAINT "land_occupancy_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."land_zones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "land_occupancy_tenant_id_id_idx" ON "land_occupancy" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "land_occupancy_tenant_zone_idx" ON "land_occupancy" USING btree ("tenant_id","zone_id","started_on");--> statement-breakpoint
CREATE INDEX "land_occupancy_tenant_occupant_idx" ON "land_occupancy" USING btree ("tenant_id","extension_slug","occupant_id");--> statement-breakpoint
ALTER TABLE "land_parcels" ADD CONSTRAINT "land_parcels_rest_target_positive" CHECK ("land_parcels"."rest_target_days" is null or "land_parcels"."rest_target_days" > 0);
