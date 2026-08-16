-- inventory: items, the LOT SPINE, and the movement ledger. Slice 0.
--
-- HAND-REORDERED FROM THE GENERATED OUTPUT, for the fourth time in this repo
-- (0125, 0130, 0132, and now here). drizzle-kit emits EVERY foreign key before
-- EVERY index, and FOUR of the composite FKs below target a unique index
-- created in THIS migration:
--
--   inventory_lots_item_fk        -> inventory_items (new)
--   inventory_lots_parent_fk      -> inventory_lots  (new, self-referential)
--   inventory_movements_item_fk   -> inventory_items (new)
--   inventory_movements_lot_fk    -> inventory_lots  (new)
--
-- Generated as emitted, every one fails with
--   there is no unique constraint matching given keys for referenced table
-- The fifth FK, inventory_movements_location_fk, points at "assets" — which
-- has existed since 0125 — and would have been fine either way. That is the
-- rule in one migration: check whether the TARGET is new, not whether an FK
-- is composite.
--
-- THE ORDER THAT WORKS: tables -> unique indexes -> foreign keys -> the rest.
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_kind" text DEFAULT 'supply' NOT NULL,
	"stocking_unit" text NOT NULL,
	"purchase_unit" text,
	"purchase_unit_qty" numeric(18, 4),
	"storage_requirement" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_name_present" CHECK (length(btrim("inventory_items"."name")) > 0),
	CONSTRAINT "inventory_items_kind_format" CHECK ("inventory_items"."item_kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "inventory_items_status_valid" CHECK ("inventory_items"."status" in ('active', 'archived')),
	CONSTRAINT "inventory_items_stocking_unit_present" CHECK (length(btrim("inventory_items"."stocking_unit")) > 0),
	CONSTRAINT "inventory_items_purchase_unit_complete" CHECK ("inventory_items"."purchase_unit_qty" is null or ("inventory_items"."purchase_unit" is not null and "inventory_items"."purchase_unit_qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"source" text DEFAULT 'purchased' NOT NULL,
	"parent_lot_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lots_code_present" CHECK (length(btrim("inventory_lots"."code")) > 0),
	CONSTRAINT "inventory_lots_source_valid" CHECK ("inventory_lots"."source" in ('purchased', 'raised', 'produced')),
	CONSTRAINT "inventory_lots_status_valid" CHECK ("inventory_lots"."status" in ('open', 'closed')),
	CONSTRAINT "inventory_lots_parent_not_self" CHECK ("inventory_lots"."parent_lot_id" is null or "inventory_lots"."parent_lot_id" <> "inventory_lots"."id")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"location_asset_id" uuid,
	"quantity" numeric(18, 4) NOT NULL,
	"movement_kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"extension_slug" text DEFAULT 'inventory' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_quantity_nonzero" CHECK ("inventory_movements"."quantity" <> 0),
	CONSTRAINT "inventory_movements_kind_format" CHECK ("inventory_movements"."movement_kind" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_tenant_id_id_idx" ON "inventory_items" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_tenant_id_id_idx" ON "inventory_lots" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_tenant_id_id_idx" ON "inventory_movements" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_parent_fk" FOREIGN KEY ("tenant_id","parent_lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_fk" FOREIGN KEY ("tenant_id","location_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_kind_idx" ON "inventory_items" USING btree ("tenant_id","item_kind");
--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_status_idx" ON "inventory_items" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_item_idx" ON "inventory_lots" USING btree ("tenant_id","item_id");
--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_parent_idx" ON "inventory_lots" USING btree ("tenant_id","parent_lot_id");
--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_status_idx" ON "inventory_lots" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_item_idx" ON "inventory_movements" USING btree ("tenant_id","item_id","occurred_on");
--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_lot_idx" ON "inventory_movements" USING btree ("tenant_id","lot_id");
--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_location_idx" ON "inventory_movements" USING btree ("tenant_id","location_asset_id");
