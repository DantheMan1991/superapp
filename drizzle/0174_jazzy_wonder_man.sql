-- Retail slice 1 - the till: sales, lines, stockouts, and the two ends of the
-- cash tin.
--
-- HAND-REORDERED. Eleventh time the question has been asked, sixth time the
-- answer was yes:
--
--   * `retail_sale_lines_sale_fk` points at `retail_sales(tenant_id, id)`,
--     created RIGHT HERE, whose unique index drizzle emitted below it. Hoisted.
--   * every other FK targets `inventory_items`, `inventory_lots`,
--     `inventory_movements`, `assets`, `retail_channels` or
--     `retail_market_days` - all pre-existing (the last two since 0172), all
--     already indexed, and all fine where drizzle put them.
--
-- THE COLUMN THIS MIGRATION EXISTS FOR IS `retail_sales.client_ref`, with its
-- unique index. A market stall often has no signal, so the till has to be able
-- to take a sale and post it later - which means posting WILL be retried, and a
-- retry whose first attempt succeeded but whose acknowledgement was lost would
-- take the money twice. Everything else about offline is client code that can be
-- replaced; this is the part that cannot be retrofitted without reconciling
-- every sale already taken.

CREATE TABLE "retail_sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_sale_lines_quantity_positive" CHECK ("retail_sale_lines"."quantity" > 0),
	CONSTRAINT "retail_sale_lines_price_not_negative" CHECK ("retail_sale_lines"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retail_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_ref" text,
	"channel_id" uuid NOT NULL,
	"market_day_id" uuid,
	"sold_at" timestamp with time zone NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"location_asset_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_sales_payment_format" CHECK ("retail_sales"."payment_method" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "retail_stockouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_day_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"noticed_at" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD COLUMN "opening_float_cents" bigint;--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD COLUMN "cash_counted_cents" bigint;--> statement-breakpoint
-- Hoisted: the composite FK below points at it, and it is created here.
CREATE UNIQUE INDEX "retail_sales_tenant_id_id_idx" ON "retail_sales" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."retail_sales"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sales" ADD CONSTRAINT "retail_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sales" ADD CONSTRAINT "retail_sales_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."retail_channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sales" ADD CONSTRAINT "retail_sales_market_day_fk" FOREIGN KEY ("tenant_id","market_day_id") REFERENCES "public"."retail_market_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_sales" ADD CONSTRAINT "retail_sales_location_fk" FOREIGN KEY ("tenant_id","location_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_stockouts" ADD CONSTRAINT "retail_stockouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_stockouts" ADD CONSTRAINT "retail_stockouts_market_day_fk" FOREIGN KEY ("tenant_id","market_day_id") REFERENCES "public"."retail_market_days"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_stockouts" ADD CONSTRAINT "retail_stockouts_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retail_sale_lines_tenant_id_id_idx" ON "retail_sale_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "retail_sale_lines_tenant_sale_idx" ON "retail_sale_lines" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "retail_sale_lines_tenant_item_idx" ON "retail_sale_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_sale_lines_movement_idx" ON "retail_sale_lines" USING btree ("tenant_id","inventory_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_sales_client_ref_idx" ON "retail_sales" USING btree ("tenant_id","client_ref");--> statement-breakpoint
CREATE INDEX "retail_sales_tenant_day_idx" ON "retail_sales" USING btree ("tenant_id","market_day_id");--> statement-breakpoint
CREATE INDEX "retail_sales_tenant_channel_time_idx" ON "retail_sales" USING btree ("tenant_id","channel_id","sold_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_stockouts_tenant_id_id_idx" ON "retail_stockouts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_stockouts_unique_target_idx" ON "retail_stockouts" USING btree ("tenant_id","market_day_id","item_id");--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD CONSTRAINT "retail_market_days_float_not_negative" CHECK ("retail_market_days"."opening_float_cents" is null or "retail_market_days"."opening_float_cents" >= 0);--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD CONSTRAINT "retail_market_days_counted_not_negative" CHECK ("retail_market_days"."cash_counted_cents" is null or "retail_market_days"."cash_counted_cents" >= 0);