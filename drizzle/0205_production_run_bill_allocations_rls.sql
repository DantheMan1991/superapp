-- production_run_bill_allocations: RLS. Pattern per drizzle/0169_production_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE AT THE RLS LAYER, as every table in this pack is, because RLS
-- answers only "whose rows are these". The pack's own layer keeps the writes at
-- OWNER — see `billing-ops.ts` — because settling a supplier's invoice against a
-- processing day decides which liability clears and what a variance was.
--
-- A ROW CROSSING A TENANT BOUNDARY WOULD JOIN ONE FARM'S BILL TO ANOTHER'S KILL
-- DAY, which is worse here than on most tables in this pack: the row is the only
-- thing standing between an accrual and the invoice that clears it, so a leaked
-- one does not merely disclose, it would let a reconciliation net across two
-- businesses' books. Both composite FKs are already tenant-scoped, so the
-- database refuses that pairing too; this is the layer that refuses the READ.

ALTER TABLE "production_run_bill_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_run_bill_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_run_bill_allocations_superadmin_all ON "production_run_bill_allocations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_run_bill_allocations_member_all ON "production_run_bill_allocations"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
