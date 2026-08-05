-- Saved views and pins: policies.
--
-- A VIEW IS A SAVED QUESTION, NOT DATA, and every decision below follows from
-- that. The answer is computed inside the caller's transaction where RLS has
-- already removed the rows they may not see, so a shared view cannot disclose
-- anything: two people running one view get different results, correctly, and
-- nobody has to audit a view before sharing it. That is why `is_shared` is a
-- boolean and not an access list, and why these policies are the simplest in
-- the module.
--
-- NO VISIBILITY TERM HERE, deliberately. `crm_party_details` carries one
-- because it holds what CRM knows about somebody; this table holds "name
-- contains probe". Adding a term would be protecting the question rather than
-- the answer.

ALTER TABLE "crm_saved_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_saved_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_saved_views_superadmin_all ON "crm_saved_views"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- READ: your own views, plus everything shared with the tenant.
--
-- `app_current_user()` returns NULL when unset and `owner_clerk_user_id = NULL`
-- is NULL rather than true, so a transaction that forgets the user id sees the
-- shared views and none of anybody's private ones. A forgotten opt-in narrows.
------------------------------------------------------------------------------

CREATE POLICY crm_saved_views_read ON "crm_saved_views"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND ("is_shared" = true OR "owner_clerk_user_id" = app_current_user())
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- WRITE: the person who made it.
--
-- WITH CHECK carries the same test as USING, so a view cannot be created in
-- somebody else's name and an existing one cannot be reassigned by updating the
-- owner column — the row would fail the check on its way out.
------------------------------------------------------------------------------

CREATE POLICY crm_saved_views_owner_all ON "crm_saved_views"
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
-- And a tenant owner may DELETE any of them.
--
-- THE ONE THING THIS SOLVES: somebody leaves, and their shared views are
-- otherwise unmanageable forever — nobody can rename them, nobody can remove
-- them, and they sit in every colleague's picker. An owner can clear them up.
--
-- FOR DELETE WITH A `USING` CLAUSE, WHICH IS THE CORRECT SPELLING. WITH CHECK
-- is not consulted for DELETE (0067), so a delete-only grant is expressed as
-- USING and nothing else — and because permissive policies OR together, this
-- widens deletion without widening anything else. An owner still cannot READ a
-- colleague's private view, or edit one.
------------------------------------------------------------------------------

CREATE POLICY crm_saved_views_admin_delete ON "crm_saved_views"
  FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- Pins are a preference about how ONE person works, so they are per user in
-- both directions: nobody reads anybody else's, nobody writes anybody else's.
-- There is no tenant-owner override, because there is nothing to administer —
-- a pin naming a view that no longer resolves simply falls back to the default.
------------------------------------------------------------------------------

ALTER TABLE "crm_view_pins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_view_pins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_view_pins_superadmin_all ON "crm_view_pins"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_view_pins_own_all ON "crm_view_pins"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
