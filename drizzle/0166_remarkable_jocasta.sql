-- Livestock slice 3 - treatments and the withdrawal clock.
--
-- NO HAND-REORDERING. Both composite FKs point at tables that already exist:
-- `livestock_lots` since 0138 and `inventory_movements` since 0136, each with
-- its unique index already in place. The rule is *check whether the target is
-- created in the same migration*, not *always reorder* - seventh check, second
-- time running the answer was no.

CREATE TABLE "livestock_treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"treated_on" date NOT NULL,
	"product" text NOT NULL,
	"dose" text DEFAULT '' NOT NULL,
	"route" text NOT NULL,
	"head_treated" numeric(18, 4),
	"meat_withdrawal_days" integer,
	"milk_withdrawal_days" integer,
	"withdrawal_source" text DEFAULT 'label' NOT NULL,
	"administered_by" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"inventory_movement_id" uuid,
	"recorded_by" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_treatments_route_format" CHECK ("livestock_treatments"."route" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "livestock_treatments_product_present" CHECK (length(btrim("livestock_treatments"."product")) > 0),
	CONSTRAINT "livestock_treatments_source_valid" CHECK ("livestock_treatments"."withdrawal_source" in ('label', 'vet', 'none_stated')),
	CONSTRAINT "livestock_treatments_meat_days_valid" CHECK ("livestock_treatments"."meat_withdrawal_days" is null or "livestock_treatments"."meat_withdrawal_days" >= 0),
	CONSTRAINT "livestock_treatments_milk_days_valid" CHECK ("livestock_treatments"."milk_withdrawal_days" is null or "livestock_treatments"."milk_withdrawal_days" >= 0),
	CONSTRAINT "livestock_treatments_head_positive" CHECK ("livestock_treatments"."head_treated" is null or "livestock_treatments"."head_treated" > 0)
);
--> statement-breakpoint
ALTER TABLE "livestock_treatments" ADD CONSTRAINT "livestock_treatments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_treatments" ADD CONSTRAINT "livestock_treatments_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_treatments" ADD CONSTRAINT "livestock_treatments_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_treatments_tenant_id_id_idx" ON "livestock_treatments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_treatments_tenant_lot_day_idx" ON "livestock_treatments" USING btree ("tenant_id","livestock_lot_id","treated_on");--> statement-breakpoint
CREATE INDEX "livestock_treatments_tenant_product_idx" ON "livestock_treatments" USING btree ("tenant_id","product");