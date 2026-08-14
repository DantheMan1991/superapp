-- Sales tax: a tenant-owned rate list, and the frozen tax block on an invoice.
--
-- FULLY ADDITIVE, and safe to apply AHEAD of the deploy (the standing order in
-- docs/conventions.md 4). The previous deployment does not select any of these
-- columns and never writes them, and every one carries a DEFAULT.
--
-- WHAT IS DELIBERATELY NOT HERE: the CHECK `total_cents = subtotal_cents +
-- tax_cents`. The running deployment's updateInvoiceDraft writes total_cents
-- without touching subtotal_cents, so that constraint would reject every draft
-- edit in the window between this migration and the deploy. It goes in the
-- follow-up migration, alongside the recurring_invoices DROP that is already
-- queued. Until then tests/sales-tax.test.ts pins the invariant.
--
-- `invoices_tax_nonnegative` IS safe here: nothing before this deploy writes
-- tax_cents, and its DEFAULT 0 satisfies it.

CREATE TABLE "sales_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_ppm" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_tax_rates_rate_ppm" CHECK ("sales_tax_rates"."rate_ppm" between 0 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "is_taxable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_rate_ppm" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subtotal_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every invoice that exists charges no tax, so its subtotal IS its total. The
-- DEFAULT 0 would otherwise leave a column that reads as a real figure and is
-- wrong — the tax summary and the total = subtotal + tax invariant both depend
-- on this. Idempotent by the tax_cents = 0 guard, so a re-run is a no-op.
UPDATE "invoices" SET "subtotal_cents" = "total_cents"
  WHERE "tax_cents" = 0 AND "subtotal_cents" = 0;--> statement-breakpoint
ALTER TABLE "sales_tax_rates" ADD CONSTRAINT "sales_tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tax_rates_tenant_id_id_idx" ON "sales_tax_rates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tax_rates_tenant_name_idx" ON "sales_tax_rates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tax_rates_tenant_default_idx" ON "sales_tax_rates" USING btree ("tenant_id") WHERE "sales_tax_rates"."is_default" = true;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_rate_fk" FOREIGN KEY ("tenant_id","tax_rate_id") REFERENCES "public"."sales_tax_rates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_nonnegative" CHECK ("invoices"."tax_cents" >= 0);
