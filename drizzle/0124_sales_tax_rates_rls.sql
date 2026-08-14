-- sales_tax_rates: RLS. Pattern per drizzle/0117_catalogue_rls.sql — ENABLE +
-- FORCE, superadmin_all, member_all.
--
-- A fourth reference list, and it takes the same shape as the other three for
-- the same reason: the invariants that matter are carried by the composite
-- foreign key from `invoices` (an invoice's rate is a same-tenant rate) and by
-- the partial unique index allowing at most one default per tenant. Who may
-- EDIT a rate is an application concern, gated at the action like every other
-- settings write; RLS decides which tenant's rows exist at all.
--
-- Note the one thing that is NOT protected by this table's policies and does
-- not need to be: `invoices.tax_rate_ppm` is a COPY taken at write time, so
-- what an issued invoice charged does not depend on this row still being
-- readable, or on it still saying the same number.

ALTER TABLE "sales_tax_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales_tax_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_tax_rates_superadmin_all ON "sales_tax_rates"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY sales_tax_rates_member_all ON "sales_tax_rates"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
