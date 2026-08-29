-- land_features (slice 2b.0). Points, lines and areas on the ground.
--
-- HAND-REORDERED FROM WHAT drizzle-kit EMITTED, and it would not have applied
-- otherwise. `land_features_fed_by_fk` is SELF-REFERENTIAL — (tenant_id,
-- fed_by_id) → (tenant_id, id) on this same table — and Postgres requires a
-- unique index on the referenced columns to exist BEFORE the constraint is
-- added. The generator emits every FK first and every index after, which is
-- correct for a reference to another table and fails with "there is no unique
-- constraint matching given keys" for a reference to this one. The unique
-- index is therefore created before the FK below.

CREATE TABLE "land_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'built' NOT NULL,
	"geometry" jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fed_by_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "land_features_kind_format" CHECK ("land_features"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "land_features_status_valid" CHECK ("land_features"."status" in ('planned', 'built', 'removed')),
	CONSTRAINT "land_features_fed_by_not_self" CHECK ("land_features"."fed_by_id" is distinct from "land_features"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "land_features_tenant_id_id_idx" ON "land_features" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "land_features" ADD CONSTRAINT "land_features_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_features" ADD CONSTRAINT "land_features_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "public"."land_parcels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_features" ADD CONSTRAINT "land_features_fed_by_fk" FOREIGN KEY ("tenant_id","fed_by_id") REFERENCES "public"."land_features"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "land_features_tenant_parcel_idx" ON "land_features" USING btree ("tenant_id","parcel_id");--> statement-breakpoint
CREATE INDEX "land_features_tenant_status_idx" ON "land_features" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "land_features_tenant_kind_idx" ON "land_features" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "land_features_tenant_fed_by_idx" ON "land_features" USING btree ("tenant_id","fed_by_id");
