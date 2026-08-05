-- Saved reports: policies.
--
-- DELIBERATELY THE SAME FOUR POLICIES AS `crm_saved_views` (0079), because a
-- report and a view are the same kind of thing: a saved QUESTION whose answer
-- is computed in the reader's own transaction. Two people opening one shared
-- report get different totals, correctly, and nobody has to audit a report
-- before sharing it.
--
-- If you are changing one of these tables, change the other or write down why
-- they have diverged. Two nearly-identical policy sets that drift apart is how
-- a reader stops being able to reason about either.

ALTER TABLE "crm_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_reports_superadmin_all ON "crm_reports"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- READ: your own, plus everything shared with the tenant.
--
-- `app_current_user()` is NULL when unset and `owner_clerk_user_id = NULL` is
-- NULL rather than true, so a transaction that forgets the user id sees the
-- shared reports and none of anybody's private ones. A forgotten opt-in
-- narrows.
------------------------------------------------------------------------------

CREATE POLICY crm_reports_read ON "crm_reports"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND ("is_shared" = true OR "owner_clerk_user_id" = app_current_user())
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- WRITE: the person who made it. WITH CHECK carries the same test, so a report
-- cannot be created in somebody else's name, nor reassigned by updating the
-- owner column — the row would fail the check on its way out.
------------------------------------------------------------------------------

CREATE POLICY crm_reports_owner_all ON "crm_reports"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND "owner_clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "owner_clerk_user_id" = app_current_user()
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- And a tenant owner may DELETE any of them, so a leaver's shared reports are
-- not permanent fixtures in everybody's list.
--
-- FOR DELETE WITH `USING` AND NOTHING ELSE, which is the correct spelling:
-- WITH CHECK is not consulted for DELETE (0067). Permissive policies OR
-- together, so this widens deletion without widening anything else — an owner
-- still cannot READ a colleague's private report, or edit one.
------------------------------------------------------------------------------

CREATE POLICY crm_reports_admin_delete ON "crm_reports"
  FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
