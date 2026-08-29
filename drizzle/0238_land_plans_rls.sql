-- land_plans, land_plan_items: RLS. Pattern per drizzle/0133_land_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, like every other table in this pack. What the
-- business is proposing to build and what it will cost in posts and wire is not
-- private correspondence; whoever is sent to build it needs the list. WHO MAY
-- CHANGE a plan is gated in the action layer, and it is OWNER-ONLY there —
-- deciding to spend money on four paddocks is a decision, not a chore, which is
-- the same line `layoutPaddocks` already draws.
--
-- A LEAK HERE WOULD PUT ANOTHER BUSINESS'S BUILD COSTS ON THIS SCREEN, and
-- `unit_cost` makes that worse than a miscount: it is what somebody typed they
-- were paying, which is the sort of figure a competitor would like.

ALTER TABLE "land_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_plans_superadmin_all ON "land_plans"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_plans_member_all ON "land_plans"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "land_plan_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "land_plan_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY land_plan_items_superadmin_all ON "land_plan_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY land_plan_items_member_all ON "land_plan_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
