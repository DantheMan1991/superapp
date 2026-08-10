-- Work, slice 3: RLS for links and saved views.
--
-- ============================================================================
-- THE GRAPH IS NOW THREE DEEP AND STILL ACYCLIC
-- ============================================================================
--
--   work_item_links  --policy reads--> work_items
--   work_items       --policy reads--> work_lists
--   work_lists       --policy reads--> (nothing; helpers only)
--   work_saved_views --policy reads--> (nothing; helpers only)
--
-- Each EXISTS runs the referenced table's own policy, so a link inherits the
-- list's visibility through the item without either rule being restated. Adding
-- an edge that points back up any of these arrows is what produces `infinite
-- recursion detected in policy for relation`; drizzle/0097 cut two such edges
-- with SECURITY DEFINER helpers and explains when that is the right answer.
--
-- ============================================================================
-- SAVED VIEWS ARE THE FIRST TABLE HERE WHERE READ AND WRITE SCOPES DIFFER
-- ============================================================================
--
-- Everything else in this module uses one FOR ALL policy, because "can see it"
-- and "can change it" are the same question. A saved view splits them:
--
--   read   — shared views, plus my own private ones
--   write  — only my own, whatever their scope
--
-- A single FOR ALL policy cannot express that. DELETE consults USING and never
-- WITH CHECK (the trap drizzle/0077 wrote up), so a USING wide enough to read
-- a colleague's shared view would also be wide enough to delete it. Hence four
-- command-specific policies and NO `FOR ALL` member policy — permissive
-- policies OR together per command, so an ALL policy beside these would widen
-- every one of them back out.
--
-- `app_current_user()` returns NULL when the caller passed no user id, and NULL
-- equals nothing, so a call that forgets it sees no private views and can write
-- nothing. Fail closed, in the direction `withWork` already guarantees.

ALTER TABLE "work_item_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY work_item_links_superadmin_all ON "work_item_links"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

------------------------------------------------------------------------------
-- Links: whatever the item says, and nothing of their own.
--
-- Note what this does NOT check: whether the LINKED record is visible. It
-- cannot — the entity is in another module's table and its type is an open
-- taxonomy with no whitelist, so there is nothing here to join to. That check
-- happens where it can: the contributor's `resolve()` runs inside the caller's
-- own transaction, so a record RLS refuses simply does not come back and the
-- chip renders as a dangling link. The link ROW is not the secret; the record
-- is, and the record defends itself.
------------------------------------------------------------------------------
CREATE POLICY work_item_links_member_all ON "work_item_links"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "work_items" i
      WHERE i."tenant_id" = "work_item_links"."tenant_id"
        AND i."id" = "work_item_links"."item_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "work_items" i
      WHERE i."tenant_id" = "work_item_links"."tenant_id"
        AND i."id" = "work_item_links"."item_id"
    )
  );--> statement-breakpoint

CREATE POLICY work_saved_views_superadmin_all ON "work_saved_views"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

-- Read: the workspace's views, and my own private ones.
CREATE POLICY work_saved_views_member_select ON "work_saved_views"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant()
    AND ("scope" = 'tenant' OR "created_by_clerk_user_id" = app_current_user())
  );--> statement-breakpoint

-- Write: only my own. Authorship cannot be forged, because WITH CHECK pins
-- `created_by_clerk_user_id` to the acting user rather than trusting the insert.
CREATE POLICY work_saved_views_member_insert ON "work_saved_views"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "created_by_clerk_user_id" = app_current_user()
  );--> statement-breakpoint

CREATE POLICY work_saved_views_member_update ON "work_saved_views"
  FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND "created_by_clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "created_by_clerk_user_id" = app_current_user()
  );--> statement-breakpoint

CREATE POLICY work_saved_views_member_delete ON "work_saved_views"
  FOR DELETE USING (
    "tenant_id" = app_current_tenant()
    AND "created_by_clerk_user_id" = app_current_user()
  );
