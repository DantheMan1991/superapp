-- inventory_cost_adjustments: RLS. Slice 3d, ADR 0012 §A.4.
--
-- MEMBER-WIDE, the same as every other table in this pack. RLS answers "whose
-- rows are these"; whether a particular person may RE-STATE what a delivery
-- cost is a write level in the pack's own layer, and it is owner-only there.
--
-- These rows FEED THE COST FOLD — `lotCarried` reads them beside the movements
-- it already reads — so one leaking across a tenant boundary would put another
-- business's money onto this one's balance sheet, and the valuation screen
-- would report it as this farm's stock. FORCE, because the app connects as
-- `app_user`, which has no BYPASSRLS: this is the backstop that holds even
-- where a query forgets its tenant term.

ALTER TABLE "inventory_cost_adjustments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_cost_adjustments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_cost_adjustments_superadmin_all ON "inventory_cost_adjustments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_cost_adjustments_member_all ON "inventory_cost_adjustments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
