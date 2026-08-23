-- bill_line_stock_allocations: RLS, and the GRNI account for tenants that
-- already have a chart. Slice 3b, ADR 0012.
--
-- MEMBER-WIDE, the same as every other pack table. RLS answers "whose rows are
-- these"; whether a particular person may MATCH a bill to a delivery is a write
-- level in the pack's own layer, not a policy. The rows here are the join
-- between what a business has and what it owes, so one leaking across a tenant
-- boundary would clear another business's liability against this one's stock —
-- and the reconciliation that is supposed to catch a mistake would report the
-- account as settled.
--
-- The GRNI insert is `0151`'s shape exactly, and for the same reason:
-- `provisionAccounting` adds template accounts only when the accounting module
-- is switched ON, so every tenant already using accounting would get
-- `LEDGER_ACCOUNTS` instead of a feature.
--
-- SKIPPED WHERE THE CODE IS ALREADY TAKEN. Guarded on BOTH the subtype and the
-- code, so a re-run is a no-op and a tenant who already numbered something 2050
-- is left alone rather than having an account nobody chose pushed into the one
-- thing in this module a client reads top to bottom.
--
-- Only tenants with an `accounting_settings` row — that is what "uses
-- accounting" means, and a tenant without one has no chart to add to.
--
-- NOTE ON REPAIR: 0151's header says a skipped tenant can be fixed "by adding
-- them by hand with the right subtype". That is NOT actually possible through
-- the UI — the add-account dialog never sends `subtype`, so `createAccount`
-- defaults it to 'other'. A tenant whose 2050 is taken needs SQL, or the
-- subtype exposed in the dialog. Recorded here rather than repeated as a claim.

ALTER TABLE "bill_line_stock_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bill_line_stock_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bill_line_stock_allocations_superadmin_all ON "bill_line_stock_allocations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bill_line_stock_allocations_member_all ON "bill_line_stock_allocations"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

INSERT INTO "accounts" ("tenant_id", "code", "name", "account_type", "subtype", "is_system", "description")
SELECT s."tenant_id", '2050', 'Goods Received Not Invoiced', 'liability', 'goods_received', true,
       'Stock that has arrived and has not been invoiced yet'
  FROM "accounting_settings" s
 WHERE NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."subtype" = 'goods_received')
   AND NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."code" = '2050');
