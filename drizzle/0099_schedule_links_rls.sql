-- Scheduling slice 3: RLS for the link table.
--
-- THE POLICY GRAPH GAINS ONE EDGE, AND IT POINTS THE SAFE WAY:
--
--   schedule_item_links --policy reads--> schedule_items
--   schedule_items      --policy reads--> schedule_calendars   (0097)
--   schedule_calendars  --policy reads--> schedule_shares      (0097)
--   schedule_shares     --policy reads--> (nothing; helpers only)
--
-- Still acyclic. `schedule_items` does NOT read this table — nothing about an
-- event's visibility depends on what it is attached to — so there is no cycle
-- to break here and no new SECURITY DEFINER helper. Read 0097's header before
-- adding any policy to these tables; that is where the two cut edges are
-- explained.
--
-- VISIBILITY INHERITS AND IS NEVER RESTATED. A link is visible exactly when its
-- EVENT is, which is in turn exactly when its calendar is. One EXISTS, and the
-- whole four-level access model applies to links for free — including the part
-- where somebody with `busy` cannot see the item row at all, and therefore sees
-- none of its links either.
--
-- WHAT A LINK DELIBERATELY DOES *NOT* CHECK: whether the caller may see the
-- record on the other end. `entity_id` is an opaque uuid here and core has no
-- idea what an invoice is. The protection is on the READ PATH instead —
-- `resolve` runs inside the caller's own transaction, so an id they may not see
-- simply does not come back and renders as a dangling link. That is invariant
-- S12 doing the work, and it is why resolution must never be moved to
-- `withSystem` for convenience.

ALTER TABLE "schedule_item_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_item_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_item_links_superadmin_all ON "schedule_item_links"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY schedule_item_links_read ON "schedule_item_links"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_links"."tenant_id"
         AND i."id" = "schedule_item_links"."item_id"
    )
  );
--> statement-breakpoint

-- WRITE: attaching a record to an event is editing the event, so it needs the
-- same `write` the event itself does. Somebody with `details` can read what an
-- event is about and cannot change it.
--
-- The test is in `USING` as well as `WITH CHECK` — WITH CHECK is not consulted
-- for DELETE (0067, 0077), so a policy that tested only there would let a
-- read-only sharee detach every record from every event they can see.
CREATE POLICY schedule_item_links_write ON "schedule_item_links"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_links"."tenant_id"
         AND i."id" = "schedule_item_links"."item_id"
         AND app_calendar_access(i."calendar_id") = 'write'
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_links"."tenant_id"
         AND i."id" = "schedule_item_links"."item_id"
         AND app_calendar_access(i."calendar_id") = 'write'
    )
  );
