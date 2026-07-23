-- Payables (session 6): RLS for the four new tables. Pattern per
-- drizzle/0001_rls.sql: ENABLE + FORCE, superadmin_all, member_all.
-- No new triggers — payables invariants ride the balance trigger,
-- CHECKs, uniques, and NO ACTION composite FKs.

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY vendors_superadmin_all ON "vendors"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY vendors_member_all ON "vendors"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bills" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bills_superadmin_all ON "bills"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bills_member_all ON "bills"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "bill_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bill_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bill_lines_superadmin_all ON "bill_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bill_lines_member_all ON "bill_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "bill_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bill_payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bill_payments_superadmin_all ON "bill_payments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bill_payments_member_all ON "bill_payments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
