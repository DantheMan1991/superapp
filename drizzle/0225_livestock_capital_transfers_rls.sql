-- livestock_capital_transfers: RLS. Pattern per drizzle/0139_livestock_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in this pack. The VERB is
-- owner-only in the action layer, and unusually for this pack that is not a
-- style choice: moving an animal between the market herd and the breeding herd
-- POSTS A JOURNAL ENTRY, and deciding what the business owns is not a chore.
--
-- These rows are the evidence behind entries that move cost from inventory to
-- fixed assets. A leak across tenants would not merely expose data — it would
-- put another farm's cow on this farm's balance sheet, and the fold that
-- decides whether an animal is breeding stock reads the LATEST row, so one
-- foreign row could silently reclassify an animal in both directions.

ALTER TABLE "livestock_capital_transfers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_capital_transfers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_capital_transfers_superadmin_all
  ON "livestock_capital_transfers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_capital_transfers_member_all
  ON "livestock_capital_transfers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
