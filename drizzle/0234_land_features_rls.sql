-- land_features: RLS. Pattern per drizzle/0133_land_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE, exactly as the other three land tables are, and for the reason
-- 0133 already gave: where things are and what they are is not private
-- correspondence. Whoever is sent to fix a waterline has to be able to find it,
-- and at 10x that person is not the owner. RLS answers "whose rows are these";
-- WHO MAY WRITE is gated in the pack's action layer.
--
-- A LEAK HERE WOULD PUT ANOTHER BUSINESS'S BURIED SERVICES ON THIS MAP. That is
-- worse than a miscount: the feature the founder asked for is a phone screen
-- that tells somebody standing in a field what is under them, and a foreign
-- buried-electric line rendered at their feet is the map lying about the ground
-- they are about to dig. `status` carries the same weight for the same reason —
-- see the column comment in src/db/schema/land.ts.

ALTER TABLE "land_features" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_features" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_features_superadmin_all ON "land_features"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_features_member_all ON "land_features"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
