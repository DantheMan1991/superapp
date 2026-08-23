-- livestock: the biology on top of an inventory lot. Slice 0.
--
-- HAND-REORDERED, fifth time (0125, 0130, 0132, 0136, and here). Only ONE of
-- the two composite FKs needed it:
--
--   livestock_identifiers_lot_fk  -> livestock_lots  (NEW in this migration)
--   livestock_lots_inventory_lot_fk -> inventory_lots (exists since 0136 — fine)
--
-- which is the rule stated once more: check whether the FK TARGET is created
-- in this migration, not whether the FK is composite.
--
-- THE ORDER THAT WORKS: tables -> unique indexes -> foreign keys -> the rest.
--
-- NOTE HOW LITTLE IS HERE for the largest pack in the profile. The lot, the
-- head ledger and the split belong to inventory; occupancy belongs to land.
-- Two tables instead of six is the pack model paying for itself.
CREATE TABLE "livestock_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"identifier_kind" text NOT NULL,
	"value" text NOT NULL,
	"applied_on" date,
	"removed_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_identifiers_kind_format" CHECK ("livestock_identifiers"."identifier_kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "livestock_identifiers_value_present" CHECK (length(btrim("livestock_identifiers"."value")) > 0),
	CONSTRAINT "livestock_identifiers_range_ordered" CHECK ("livestock_identifiers"."removed_on" is null or "livestock_identifiers"."applied_on" is null or "livestock_identifiers"."removed_on" >= "livestock_identifiers"."applied_on")
);
--> statement-breakpoint
CREATE TABLE "livestock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"species" text NOT NULL,
	"sex" text,
	"breed" text DEFAULT '' NOT NULL,
	"born_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_lots_species_format" CHECK ("livestock_lots"."species" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "livestock_lots_sex_valid" CHECK ("livestock_lots"."sex" is null or "livestock_lots"."sex" in ('male', 'female', 'mixed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_identifiers_tenant_id_id_idx" ON "livestock_identifiers" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_lots_tenant_id_id_idx" ON "livestock_lots" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_lots_tenant_inventory_lot_idx" ON "livestock_lots" USING btree ("tenant_id","inventory_lot_id");
--> statement-breakpoint
ALTER TABLE "livestock_identifiers" ADD CONSTRAINT "livestock_identifiers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestock_identifiers" ADD CONSTRAINT "livestock_identifiers_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_inventory_lot_fk" FOREIGN KEY ("tenant_id","inventory_lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "livestock_identifiers_tenant_lot_idx" ON "livestock_identifiers" USING btree ("tenant_id","livestock_lot_id");
--> statement-breakpoint
CREATE INDEX "livestock_identifiers_tenant_value_idx" ON "livestock_identifiers" USING btree ("tenant_id","value");
--> statement-breakpoint
CREATE INDEX "livestock_lots_tenant_species_idx" ON "livestock_lots" USING btree ("tenant_id","species");
