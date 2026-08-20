ALTER TABLE "inventory_movements" ADD COLUMN "cost_cents" bigint;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "issued_to_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_consumer_fk" FOREIGN KEY ("tenant_id","issued_to_lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_consumer_idx" ON "inventory_movements" USING btree ("tenant_id","issued_to_lot_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_cost_not_negative" CHECK ("inventory_movements"."cost_cents" is null or "inventory_movements"."cost_cents" >= 0);