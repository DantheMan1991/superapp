-- Work, slice 0: RLS. The part that is expensive to get wrong.
--
-- ============================================================================
-- THE DEPENDENCY GRAPH BETWEEN THESE POLICIES, AND WHY IT IS BORING
-- ============================================================================
--
--   work_items  --policy reads--> work_lists
--   work_lists  --policy reads--> (nothing; helpers only)
--
-- One edge, one direction, no cycle — so unlike drizzle/0097 there are no
-- SECURITY DEFINER helpers here at all. That is worth saying out loud, because
-- the last two modules both needed them and the next reader will expect them:
--
--   * Scheduling needed `app_owns_calendar()` because a calendar's OWNER may
--     share it, which is a read of `schedule_calendars` from the shares policy,
--     which closes calendars -> shares -> calendars.
--   * It needed `app_is_attendee()` because being invited to an item shows it
--     to you without granting the calendar, which closes items -> attendees ->
--     items.
--
-- Work has neither rule. A list is visible to members or to owners, full stop;
-- there is no per-person grant table to recurse into, and the ASSIGNEE IS NOT A
-- VISIBILITY TERM — work is the business's work, so who it is on does not
-- decide who may see it (crm.md made the same call for follow-ups, and holiday
-- cover is the reason). Adding either rule later means re-reading 0097 first.
--
-- ============================================================================
-- WHAT RLS DECIDES HERE: ALL OF IT
-- ============================================================================
--
-- Scheduling has four access levels, two of which are partial redactions, and
-- an RLS predicate cannot return half a row — hence `app_schedule_range()` and
-- a projection in application code. Work has no such level. A row is visible or
-- it is not, so these policies are the whole answer and `src/modules/work/
-- read.ts` redacts nothing. If a "can see titles only" level is ever added,
-- 0097 is the worked example — but nothing in application code should start
-- deciding visibility before then.

ALTER TABLE "work_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_lists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY work_lists_superadmin_all ON "work_lists"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

------------------------------------------------------------------------------
-- Lists: the tenant's, and owners-only ones only for owners.
--
-- `document_folders_member_all` (drizzle/0024) with the ancestor rollup removed,
-- because lists do not nest. An expert is not an owner, so an `owners` list is
-- hidden from an outside accountant the same way an owners-only folder is —
-- consistency with a shipped module beat inventing a third answer for the same
-- question.
--
-- WITH CHECK repeats USING deliberately. Without it staff could CREATE a list
-- they then cannot see, or flip an existing one to `owners` and lose it. With
-- it, both are refused at write time.
--
-- Note what USING alone governs: DELETE. WITH CHECK is not consulted for it
-- (the trap drizzle/0077 wrote up), so the fact that the two expressions are
-- identical here is what makes delete behave.
------------------------------------------------------------------------------
CREATE POLICY work_lists_member_all ON "work_lists"
  USING (
    "tenant_id" = app_current_tenant()
    AND ("visibility" = 'members' OR app_current_tenant_role() = 'owner')
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND ("visibility" = 'members' OR app_current_tenant_role() = 'owner')
  );--> statement-breakpoint

CREATE POLICY work_items_superadmin_all ON "work_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

------------------------------------------------------------------------------
-- Items: whatever their list says, and NOTHING of their own.
--
-- The EXISTS runs `work_lists`' policy — Postgres applies RLS inside policy
-- subqueries — so the visibility rule is written once and cannot drift. This is
-- the arrangement drizzle/0024 uses for `document_versions` and 0097 uses for
-- `schedule_items`; the alternative is a second copy of the rule, and two
-- copies of a visibility rule always end up disagreeing.
--
-- Two properties fall out of it rather than being written:
--
--   * An item on an owners-only list is invisible to staff. Nobody had to say
--     so; the subquery returns no row for them.
--   * Staff cannot SMUGGLE an item onto a list they cannot see, on INSERT or by
--     UPDATE-ing `list_id`, because WITH CHECK runs the same subquery under the
--     same context.
--
-- The composite FK to `work_lists` is NOT what enforces this and never was:
-- foreign key checks do not run policies.
------------------------------------------------------------------------------
CREATE POLICY work_items_member_all ON "work_items"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "work_lists" l
      WHERE l."tenant_id" = "work_items"."tenant_id"
        AND l."id" = "work_items"."list_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "work_lists" l
      WHERE l."tenant_id" = "work_items"."tenant_id"
        AND l."id" = "work_items"."list_id"
    )
  );
