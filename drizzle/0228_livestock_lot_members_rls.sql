-- livestock_lot_members: RLS. Pattern per drizzle/0139_livestock_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, matching livestock_group_members, the table
-- this one replaces: putting an animal in a lot is a chore done by whoever is
-- moving her, the same level as walking her to a paddock or putting a pen on a
-- feeder.
--
-- A LEAK HERE WOULD MISCOUNT ANOTHER FARM'S ANIMALS. A lot's head total is its
-- own balance PLUS its members', so one foreign row would add somebody else's
-- fifty birds to this farm's pen — and because the same fold feeds the daily
-- round and the feed allocation, the phantom head would go on to take a share
-- of this farm's feed bill.

ALTER TABLE "livestock_lot_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_lot_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_lot_members_superadmin_all
  ON "livestock_lot_members"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_lot_members_member_all
  ON "livestock_lot_members"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
