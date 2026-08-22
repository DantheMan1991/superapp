CREATE TYPE "public"."inventory_treatment" AS ENUM('none', 'capitalise');--> statement-breakpoint
CREATE TABLE "bill_line_stock_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_line_id" uuid NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"quantity_matched" numeric(18, 4) NOT NULL,
	"receipt_cost_cents" bigint NOT NULL,
	"invoice_cost_cents" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_line_stock_allocations_quantity_positive" CHECK ("bill_line_stock_allocations"."quantity_matched" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "inventory_treatment" "inventory_treatment" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_line_stock_allocations" ADD CONSTRAINT "bill_line_stock_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line_stock_allocations" ADD CONSTRAINT "bill_line_stock_allocations_line_fk" FOREIGN KEY ("tenant_id","bill_line_id") REFERENCES "public"."bill_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line_stock_allocations" ADD CONSTRAINT "bill_line_stock_allocations_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_line_stock_allocations_tenant_id_id_idx" ON "bill_line_stock_allocations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_line_stock_allocations_pair_idx" ON "bill_line_stock_allocations" USING btree ("tenant_id","bill_line_id","inventory_movement_id");--> statement-breakpoint
CREATE INDEX "bill_line_stock_allocations_movement_idx" ON "bill_line_stock_allocations" USING btree ("tenant_id","inventory_movement_id");