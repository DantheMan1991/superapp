-- livestock_groups and livestock_group_members: RLS. Pattern per
-- drizzle/0139_livestock_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in this pack: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Creating a herd is an `owner` verb there; MOVING one is `member`,
-- because walking a mob to the next paddock is the definition of a chore.
--
-- A membership row leaking across tenants would not merely expose data — it
-- would move animals. `moveGroupToZone` writes `land_occupancy` for every member
-- it finds, so another farm's membership appearing here would put this farm's
-- cattle on a paddock they were never on, and start that paddock's rest clock
-- from a stay that never happened.

ALTER TABLE "livestock_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_groups_superadmin_all ON "livestock_groups"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_groups_member_all ON "livestock_groups"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "livestock_group_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_group_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_group_members_superadmin_all ON "livestock_group_members"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_group_members_member_all ON "livestock_group_members"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
