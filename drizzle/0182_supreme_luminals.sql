CREATE TYPE "public"."inventory_timing_rule" AS ENUM('consumed', 'billed', 'paid', 'sold', 'later_of_paid_and_consumed', 'later_of_paid_and_sold');--> statement-breakpoint
CREATE TABLE "inventory_tax_treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_kind" text,
	"timing_rule" "inventory_timing_rule" DEFAULT 'consumed' NOT NULL,
	"expense_account_id" uuid,
	"decided_by" text DEFAULT '' NOT NULL,
	"decided_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_tax_treatments_kind_format" CHECK ("inventory_tax_treatments"."item_kind" is null or "inventory_tax_treatments"."item_kind" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_tax_treatments" ADD CONSTRAINT "inventory_tax_treatments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_tax_treatments" ADD CONSTRAINT "inventory_tax_treatments_account_fk" FOREIGN KEY ("tenant_id","expense_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_tax_treatments_tenant_id_id_idx" ON "inventory_tax_treatments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_tax_treatments_tenant_kind_idx" ON "inventory_tax_treatments" USING btree ("tenant_id","item_kind");