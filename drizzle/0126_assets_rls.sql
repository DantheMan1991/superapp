-- assets: RLS. Pattern per drizzle/0124_sales_tax_rates_rls.sql — ENABLE +
-- FORCE, superadmin_all, member_all.
--
-- THE FIRST PACK-OWNED TABLE, and it gets the ordinary treatment on purpose.
-- A capability pack's tables are not a new security category: tenant_id, FORCE
-- RLS, and an isolation test, exactly like Layer 1. If a pack ever needed a
-- weaker policy than a core module, that would be the signal the boundary was
-- drawn wrong, not that the rule has exceptions.
--
-- MEMBER-WIDE, NOT OWNER-ONLY, and the split is deliberate. What the business
-- owns is not private correspondence — whoever is sent to service the tractor
-- needs to find it, and a staff member counting a freezer needs to know which
-- freezer. So RLS answers only "whose rows are these", and WHO MAY WRITE is
-- gated in the pack's action layer (owner-only, because an asset's cost and
-- disposal are capital decisions and because syncing a dimension member
-- requires the owner role — see src/packs/assets/ops.ts).
--
-- That is the same division of labour as `sales_tax_rates`: the database
-- decides which tenant's rows exist at all, the application decides who may
-- change them. It is NOT the `document_folders` arrangement, where visibility
-- itself varies by role and therefore has to reach `app_tenant_role()`. Assets
-- have no owners-only subset, so borrowing that machinery would be cost
-- without a reason.

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assets_superadmin_all ON "assets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY assets_member_all ON "assets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
