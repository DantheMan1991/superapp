-- inventory_counts, inventory_count_lines: RLS. Pattern per
-- drizzle/0137_inventory_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, and this is the clearest case in the pack. Counting a freezer is
-- the definition of a chore: it is done by whoever was sent to do it, standing
-- in the cold with a clipboard, and a count only the owner could enter is a
-- count nobody takes. RLS answers "whose rows are these"; which verb needs which
-- role is the pack's own layer, and there every verb here is `member` because
-- none of them creates a cost object.
--
-- WHY THESE GET THEIR OWN POLICY PAIR RATHER THAN LEANING ON THE LEDGER'S.
-- A posted count is the evidence behind an adjustment: it is what says the
-- variance came from somebody walking the shelves rather than from somebody
-- typing a number they liked better. `inventory_movements` is FORCEd in its own
-- right because it is the traceability chain, and these rows are the reason one
-- link in that chain exists.
--
-- Cross-tenant leakage would not merely expose data: another farm's count line
-- appearing here would attribute their shelf to this farm's ledger, and the
-- variance it posted would be a correction to stock that was never counted.

ALTER TABLE "inventory_counts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_counts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_counts_superadmin_all ON "inventory_counts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_counts_member_all ON "inventory_counts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "inventory_count_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_count_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_count_lines_superadmin_all ON "inventory_count_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_count_lines_member_all ON "inventory_count_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
