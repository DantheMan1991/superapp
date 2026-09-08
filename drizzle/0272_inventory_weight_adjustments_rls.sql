-- inventory_weight_adjustments: RLS. 2026-09-08 — the weight twin of
-- inventory_cost_adjustments (0181), for the correction the founder could not
-- make when five one-pound packages were recorded as 1 lb.
--
-- These rows FEED THE WEIGHT FOLD — `weightRatesForItems` reads them beside the
-- receipts — so one leaking across a tenant boundary would change what another
-- business's freezer reads in pounds and what its till sells by. FORCE, because
-- the app connects as `app_user`, which has no BYPASSRLS: this is the backstop
-- that holds even where a query forgets its tenant term.
--
-- THE NEWER POSTURE (deposits 0266, credit memos 0270) rather than 0181's
-- member-wide one: members read, OWNERS insert, nobody updates or deletes. A
-- correction is appended and put right by another correction, never edited.
-- `adjustLotWeight` is owner-only and its action passes `{ role }` to
-- withTenant; a write that forgets is refused, because the default role is
-- `staff`. tests/isolation/inventory.test.ts asserts each clause here.

ALTER TABLE "inventory_weight_adjustments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_weight_adjustments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_weight_adjustments_superadmin_all ON "inventory_weight_adjustments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_weight_adjustments_member_read ON "inventory_weight_adjustments" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY inventory_weight_adjustments_owner_insert ON "inventory_weight_adjustments" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
