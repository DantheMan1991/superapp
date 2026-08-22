ALTER TYPE "public"."journal_entry_source" ADD VALUE 'inventory_cost_adjustment' BEFORE 'intercompany';--> statement-breakpoint
CREATE TABLE "inventory_cost_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"on_hand_cents" bigint NOT NULL,
	"issued_cents" bigint NOT NULL,
	"quantity_on_hand" numeric(18, 4) NOT NULL,
	"quantity_received" numeric(18, 4) NOT NULL,
	"reason" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_adjustments_amount_nonzero" CHECK ("inventory_cost_adjustments"."amount_cents" <> 0),
	CONSTRAINT "inventory_cost_adjustments_split_sums" CHECK ("inventory_cost_adjustments"."on_hand_cents" + "inventory_cost_adjustments"."issued_cents" = "inventory_cost_adjustments"."amount_cents"),
	CONSTRAINT "inventory_cost_adjustments_reason_format" CHECK ("inventory_cost_adjustments"."reason" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_cost_adjustments_tenant_id_id_idx" ON "inventory_cost_adjustments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "inventory_cost_adjustments_tenant_lot_idx" ON "inventory_cost_adjustments" USING btree ("tenant_id","lot_id","occurred_on");--> statement-breakpoint
CREATE INDEX "inventory_cost_adjustments_tenant_item_idx" ON "inventory_cost_adjustments" USING btree ("tenant_id","item_id","occurred_on");