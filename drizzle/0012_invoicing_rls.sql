-- Invoicing / AR (session 4): RLS for the five new tables. Pattern per
-- drizzle/0001_rls.sql: ENABLE + FORCE, superadmin_all, member_all.
-- No new triggers — invoicing invariants ride the balance trigger,
-- CHECKs, uniques, and NO ACTION composite FKs.

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customers_superadmin_all ON "customers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY customers_member_all ON "customers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_superadmin_all ON "invoices"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY invoices_member_all ON "invoices"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_lines_superadmin_all ON "invoice_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY invoice_lines_member_all ON "invoice_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_payments_superadmin_all ON "invoice_payments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY invoice_payments_member_all ON "invoice_payments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "recurring_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_invoices_superadmin_all ON "recurring_invoices"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY recurring_invoices_member_all ON "recurring_invoices"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
