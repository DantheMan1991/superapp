-- Banking (session 3): RLS for the five new tables. Pattern per
-- drizzle/0001_rls.sql / 0008: ENABLE + FORCE, superadmin_all, member_all.
-- No new triggers — the reconciled-line invariant is carried by the
-- NO ACTION composite FK on reconciliation_lines.journal_line_id.

ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bank_accounts_superadmin_all ON "bank_accounts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bank_accounts_member_all ON "bank_accounts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bank_transactions_superadmin_all ON "bank_transactions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bank_transactions_member_all ON "bank_transactions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "reconciliations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reconciliations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reconciliations_superadmin_all ON "reconciliations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY reconciliations_member_all ON "reconciliations"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "reconciliation_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reconciliation_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reconciliation_lines_superadmin_all ON "reconciliation_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY reconciliation_lines_member_all ON "reconciliation_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "plaid_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plaid_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plaid_items_superadmin_all ON "plaid_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY plaid_items_member_all ON "plaid_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
