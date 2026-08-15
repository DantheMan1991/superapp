-- land_occupancy: RLS. Pattern per drizzle/0133_land_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE READS AND WRITES AT THE DATABASE LAYER, and this table is the
-- first in the pack where that will stop being merely convenient. Occupancy is
-- the record `livestock` and `crops` write through — a pack may not read
-- another pack's tables, so the fact lands here and the rest clock is computed
-- from it. Every one of those writers runs under the same tenant context, so
-- the policy does not need to know which pack wrote a row, and deliberately
-- does not: `extension_slug` is data, never a security boundary. A pack being
-- switched off must not make its history unreadable.
--
-- WHO MAY WRITE stays in the application layer (owner-only,
-- src/packs/land/ops.ts), exactly as it is for parcels, zones and uses.

ALTER TABLE "land_occupancy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_occupancy" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_occupancy_superadmin_all ON "land_occupancy"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_occupancy_member_all ON "land_occupancy"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
