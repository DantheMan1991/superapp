CREATE TABLE "inventory_weight_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"delta_lb" numeric(18, 4) NOT NULL,
	"recorded_lb" numeric(18, 4) NOT NULL,
	"quantity_weighed" numeric(18, 4) NOT NULL,
	"reason" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_weight_adjustments_delta_nonzero" CHECK ("inventory_weight_adjustments"."delta_lb" <> 0),
	CONSTRAINT "inventory_weight_adjustments_stays_positive" CHECK ("inventory_weight_adjustments"."recorded_lb" + "inventory_weight_adjustments"."delta_lb" > 0),
	CONSTRAINT "inventory_weight_adjustments_reason_format" CHECK ("inventory_weight_adjustments"."reason" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_weight_adjustments" ADD CONSTRAINT "inventory_weight_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_weight_adjustments" ADD CONSTRAINT "inventory_weight_adjustments_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_weight_adjustments" ADD CONSTRAINT "inventory_weight_adjustments_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_weight_adjustments_tenant_id_id_idx" ON "inventory_weight_adjustments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "inventory_weight_adjustments_tenant_lot_idx" ON "inventory_weight_adjustments" USING btree ("tenant_id","lot_id","occurred_on");--> statement-breakpoint
CREATE INDEX "inventory_weight_adjustments_tenant_item_idx" ON "inventory_weight_adjustments" USING btree ("tenant_id","item_id","occurred_on");