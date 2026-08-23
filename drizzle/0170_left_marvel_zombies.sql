-- Inventory slice 2 - adjustments carry a reason, counts reconcile to actual,
-- and a batch can say when it stops being good.
--
-- HAND-REORDERED. Ninth time the question has been asked, fourth time the answer
-- was yes, and as in 0168 BOTH answers appear in one file:
--
--   * `inventory_count_lines_count_fk` points at `inventory_counts(tenant_id,
--     id)`, created RIGHT HERE, whose unique index drizzle emitted at the
--     bottom. A composite FK needs a unique index on its target, so it would
--     have failed. Hoisted above it.
--   * the other four FKs target `inventory_items`, `inventory_lots`,
--     `inventory_movements` and `assets` - all pre-existing, all already
--     indexed, and all fine exactly where drizzle put them.
--
-- The two ALTER TABLE ... ADD COLUMN statements are additive and nullable, so
-- every existing row keeps working: a lot with no expiry is one nobody has
-- dated, and a movement with no reason is one whose kind already says why.

CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"counted_quantity" numeric(18, 4) NOT NULL,
	"expected_quantity" numeric(18, 4),
	"inventory_movement_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_lines_counted_not_negative" CHECK ("inventory_count_lines"."counted_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"location_asset_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"counted_by" text DEFAULT '' NOT NULL,
	"posted_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_status_valid" CHECK ("inventory_counts"."status" in ('draft', 'posted')),
	CONSTRAINT "inventory_counts_posted_together" CHECK (("inventory_counts"."status" = 'posted') = ("inventory_counts"."posted_on" is not null)),
	CONSTRAINT "inventory_counts_posted_after_counted" CHECK ("inventory_counts"."posted_on" is null or "inventory_counts"."posted_on" >= "inventory_counts"."counted_on")
);
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "expires_on" date;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "reason" text;--> statement-breakpoint
-- Hoisted: the composite FK below points at it, and it is created here.
CREATE UNIQUE INDEX "inventory_counts_tenant_id_id_idx" ON "inventory_counts" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_fk" FOREIGN KEY ("tenant_id","count_id") REFERENCES "public"."inventory_counts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_location_fk" FOREIGN KEY ("tenant_id","location_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_count_lines_tenant_id_id_idx" ON "inventory_count_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "inventory_count_lines_tenant_count_idx" ON "inventory_count_lines" USING btree ("tenant_id","count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_count_lines_unique_target_idx" ON "inventory_count_lines" USING btree ("tenant_id","count_id","item_id","lot_id");--> statement-breakpoint
CREATE INDEX "inventory_counts_tenant_status_idx" ON "inventory_counts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inventory_counts_tenant_date_idx" ON "inventory_counts" USING btree ("tenant_id","counted_on");--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_expires_idx" ON "inventory_lots" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_reason_idx" ON "inventory_movements" USING btree ("tenant_id","reason","occurred_on");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reason_format" CHECK ("inventory_movements"."reason" is null or "inventory_movements"."reason" ~ '^[a-z][a-z0-9_]{0,62}$');