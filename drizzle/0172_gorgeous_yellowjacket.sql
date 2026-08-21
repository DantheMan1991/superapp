-- Retail slice 0 - channels, per-item-per-channel prices, and what a day of
-- selling cost.
--
-- HAND-REORDERED. Tenth time the question has been asked, fifth time the answer
-- was yes:
--
--   * `retail_market_days_channel_fk` and `retail_prices_channel_fk` both point
--     at `retail_channels(tenant_id, id)`, created RIGHT HERE, whose unique
--     index drizzle emitted below them. A composite FK needs a unique index on
--     its target, so both would have failed. Hoisted above them.
--   * `retail_prices_item_fk` targets `inventory_items`, which has existed since
--     0136 and is already indexed. Fine exactly where drizzle put it.

CREATE TABLE "retail_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel_kind" text DEFAULT 'direct' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_channels_name_present" CHECK (length(btrim("retail_channels"."name")) > 0),
	CONSTRAINT "retail_channels_kind_format" CHECK ("retail_channels"."channel_kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "retail_channels_status_valid" CHECK ("retail_channels"."status" in ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "retail_market_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"held_on" date NOT NULL,
	"stall_fee_cents" bigint,
	"travel_cents" bigint,
	"crew_size" integer,
	"hours" numeric(18, 2),
	"weather" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_market_days_fee_not_negative" CHECK ("retail_market_days"."stall_fee_cents" is null or "retail_market_days"."stall_fee_cents" >= 0),
	CONSTRAINT "retail_market_days_travel_not_negative" CHECK ("retail_market_days"."travel_cents" is null or "retail_market_days"."travel_cents" >= 0),
	CONSTRAINT "retail_market_days_crew_positive" CHECK ("retail_market_days"."crew_size" is null or "retail_market_days"."crew_size" > 0),
	CONSTRAINT "retail_market_days_hours_positive" CHECK ("retail_market_days"."hours" is null or "retail_market_days"."hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "retail_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_prices_not_negative" CHECK ("retail_prices"."price_cents" >= 0)
);
--> statement-breakpoint
-- Hoisted: the two composite FKs below point at it, and it is created here.
CREATE UNIQUE INDEX "retail_channels_tenant_id_id_idx" ON "retail_channels" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "retail_channels" ADD CONSTRAINT "retail_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD CONSTRAINT "retail_market_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_market_days" ADD CONSTRAINT "retail_market_days_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."retail_channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."retail_channels"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retail_channels_tenant_status_idx" ON "retail_channels" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "retail_channels_tenant_kind_idx" ON "retail_channels" USING btree ("tenant_id","channel_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_market_days_tenant_id_id_idx" ON "retail_market_days" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "retail_market_days_tenant_channel_idx" ON "retail_market_days" USING btree ("tenant_id","channel_id");--> statement-breakpoint
CREATE INDEX "retail_market_days_tenant_date_idx" ON "retail_market_days" USING btree ("tenant_id","held_on");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_prices_tenant_id_id_idx" ON "retail_prices" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "retail_prices_unique_start_idx" ON "retail_prices" USING btree ("tenant_id","channel_id","item_id","effective_from");