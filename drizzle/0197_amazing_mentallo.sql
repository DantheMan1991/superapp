-- Cut sheets: `production_orders` + `production_order_lines`, and the run's
-- `processing_fee_cents`.
--
-- HAND-REORDERED — eleventh check, fourth yes. `production_order_lines_order_fk`
-- targets `production_orders (tenant_id, id)`, an index this same file creates,
-- and `db:generate` emitted the constraint above it. The rule is *check whether
-- the target is created in the same migration*, not *always reorder*: the other
-- five FKs here point at `production_processors`, `production_bookings`,
-- `production_runs`, `production_processor_price_items` and `tenants`, every one
-- of which was created by an earlier migration, so drizzle's ordering was
-- already right for them.
--
-- The `journal_entry_source` value this pack needs is in `0198`, on its own, the
-- arrangement `depreciation` and `intercompany` established: an enum value
-- cannot be USED in the transaction that adds it, and drizzle runs every pending
-- migration in one.

CREATE TABLE "production_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"price_item_id" uuid,
	"category" text DEFAULT 'extra' NOT NULL,
	"label" text NOT NULL,
	"unit_price_cents" integer,
	"unit" text,
	"minimum_cents" integer,
	"quantity" numeric(18, 4),
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_order_lines_label_present" CHECK (length(btrim("production_order_lines"."label")) > 0),
	CONSTRAINT "production_order_lines_category_format" CHECK ("production_order_lines"."category" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_order_lines_price_has_unit" CHECK ("production_order_lines"."unit_price_cents" is null or "production_order_lines"."unit" is not null),
	CONSTRAINT "production_order_lines_unit_valid" CHECK ("production_order_lines"."unit" is null or "production_order_lines"."unit" in ('head', 'live_lb', 'hanging_lb', 'finished_lb', 'package', 'box', 'flat', 'hour')),
	CONSTRAINT "production_order_lines_price_nonneg" CHECK ("production_order_lines"."unit_price_cents" is null or "production_order_lines"."unit_price_cents" >= 0),
	CONSTRAINT "production_order_lines_minimum_nonneg" CHECK ("production_order_lines"."minimum_cents" is null or "production_order_lines"."minimum_cents" >= 0),
	CONSTRAINT "production_order_lines_quantity_positive" CHECK ("production_order_lines"."quantity" is null or "production_order_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"booking_id" uuid,
	"run_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"head_count" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_attached" CHECK ("production_orders"."booking_id" is not null or "production_orders"."run_id" is not null),
	CONSTRAINT "production_orders_kind_format" CHECK ("production_orders"."kind" = '' or "production_orders"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_orders_head_positive" CHECK ("production_orders"."head_count" is null or "production_orders"."head_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "processing_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_price_item_fk" FOREIGN KEY ("tenant_id","price_item_id") REFERENCES "public"."production_processor_price_items"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_booking_fk" FOREIGN KEY ("tenant_id","booking_id") REFERENCES "public"."production_bookings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_order_lines_tenant_id_id_idx" ON "production_order_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_order_lines_order_idx" ON "production_order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_tenant_id_id_idx" ON "production_orders" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."production_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_orders_tenant_booking_idx" ON "production_orders" USING btree ("tenant_id","booking_id");--> statement-breakpoint
CREATE INDEX "production_orders_tenant_run_idx" ON "production_orders" USING btree ("tenant_id","run_id");--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_fee_nonneg" CHECK ("production_runs"."processing_fee_cents" is null or "production_runs"."processing_fee_cents" >= 0);