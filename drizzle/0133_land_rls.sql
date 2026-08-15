-- land: RLS. Pattern per drizzle/0126_assets_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all, one policy pair per table.
--
-- MEMBER-WIDE, NOT OWNER-ONLY, for the same reason assets are: where the
-- ground is and what it is for is not private correspondence. Whoever is sent
-- to move a fence needs to find the paddock, and at 10× the person doing it is
-- not the owner. So RLS answers only "whose rows are these", and WHO MAY WRITE
-- is gated in the pack's action layer (owner-only, because a parcel and a zone
-- are cost objects and syncing a dimension member requires the owner role —
-- see src/packs/land/ops.ts).
--
-- That is the same division of labour as `assets` and `sales_tax_rates`: the
-- database decides which tenant's rows exist at all, the application decides
-- who may change them. It is NOT the `document_folders` arrangement, where
-- visibility itself varies by role and therefore has to reach
-- `app_tenant_role()`. Land has no owners-only subset, so borrowing that
-- machinery would be cost without a reason.
--
-- All three tables get the same treatment INCLUDING `land_zone_uses`, which
-- carries no `tenant_id`-bearing meaning of its own beyond its zone. Relying on
-- the composite FK to keep it honest would be depending on a constraint to do a
-- policy's job: FORCE RLS on the child is what makes "no context, no rows" true
-- for the use history as well as for the zone.

ALTER TABLE "land_parcels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_parcels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_parcels_superadmin_all ON "land_parcels"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_parcels_member_all ON "land_parcels"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "land_zones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_zones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_zones_superadmin_all ON "land_zones"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_zones_member_all ON "land_zones"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "land_zone_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_zone_uses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_zone_uses_superadmin_all ON "land_zone_uses"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_zone_uses_member_all ON "land_zone_uses"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
