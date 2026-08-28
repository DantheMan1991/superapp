CREATE TABLE "livestock_capital_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"occurred_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"asset_id" uuid,
	"inventory_movement_id" uuid,
	"journal_entry_id" uuid,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_capital_transfers_direction_valid" CHECK ("livestock_capital_transfers"."direction" in ('to_breeding', 'to_market')),
	CONSTRAINT "livestock_capital_transfers_amount_valid" CHECK ("livestock_capital_transfers"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "livestock_capital_transfers" ADD CONSTRAINT "livestock_capital_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_capital_transfers" ADD CONSTRAINT "livestock_capital_transfers_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_capital_transfers" ADD CONSTRAINT "livestock_capital_transfers_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_capital_transfers" ADD CONSTRAINT "livestock_capital_transfers_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_capital_transfers_tenant_id_id_idx" ON "livestock_capital_transfers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_capital_transfers_tenant_lot_idx" ON "livestock_capital_transfers" USING btree ("tenant_id","livestock_lot_id","occurred_on");