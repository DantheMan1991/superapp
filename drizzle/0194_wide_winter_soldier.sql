CREATE TABLE "production_processor_price_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'extra' NOT NULL,
	"label" text NOT NULL,
	"price_cents" integer,
	"unit" text NOT NULL,
	"minimum_cents" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_processor_price_items_kind_format" CHECK ("production_processor_price_items"."kind" = '' or "production_processor_price_items"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_processor_price_items_category_format" CHECK ("production_processor_price_items"."category" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_processor_price_items_label_present" CHECK (length(btrim("production_processor_price_items"."label")) > 0),
	CONSTRAINT "production_processor_price_items_unit_valid" CHECK ("production_processor_price_items"."unit" in ('head', 'live_lb', 'hanging_lb', 'finished_lb', 'package', 'box', 'flat', 'hour')),
	CONSTRAINT "production_processor_price_items_price_nonneg" CHECK ("production_processor_price_items"."price_cents" is null or "production_processor_price_items"."price_cents" >= 0),
	CONSTRAINT "production_processor_price_items_minimum_nonneg" CHECK ("production_processor_price_items"."minimum_cents" is null or "production_processor_price_items"."minimum_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD CONSTRAINT "production_processor_price_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD CONSTRAINT "production_processor_price_items_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_price_items_tenant_id_id_idx" ON "production_processor_price_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_price_items_unique_idx" ON "production_processor_price_items" USING btree ("tenant_id","processor_id","kind","label");--> statement-breakpoint
CREATE INDEX "production_processor_price_items_processor_idx" ON "production_processor_price_items" USING btree ("tenant_id","processor_id");