-- Scheduling, slice 0: RLS. The part that is expensive to get wrong.
--
-- ============================================================================
-- THE DEPENDENCY GRAPH BETWEEN THESE POLICIES, WHICH MUST STAY ACYCLIC
-- ============================================================================
--
--   schedule_items       --policy reads--> schedule_calendars
--   schedule_calendars   --policy reads--> schedule_shares
--   schedule_shares      --policy reads--> (nothing; helpers only)
--   schedule_item_attendees --policy reads--> schedule_items
--
-- Postgres evaluates policies inside policy subqueries, so any cycle here is
-- `infinite recursion detected in policy for relation` on the first SELECT —
-- loud, total, and it takes the module down rather than leaking anything.
-- drizzle/0077 spent this same one-way promise for crm_record_collaborators.
--
-- TWO EDGES WOULD CLOSE A CYCLE, AND BOTH ARE CUT WITH A HELPER INSTEAD:
--
--  1. schedule_shares needs "do I administer this calendar?" for its WRITE
--     policy, because a calendar's owner must be able to share it and not only
--     a tenant owner. Reading schedule_calendars there closes
--     calendars -> shares -> calendars.
--  2. schedule_items needs "am I an attendee?", which is what lets somebody see
--     an item on a calendar they have no access to. Reading
--     schedule_item_attendees there closes items -> attendees -> items.
--
-- Both are SECURITY DEFINER booleans. drizzle/0077 named this exact remedy:
-- "the answer is a SECURITY DEFINER helper, not an EXISTS".
--
-- WHY DEFINER RIGHTS ARE ACCEPTABLE HERE AND WERE REFUSED IN 0061. That file
-- refused them for a TRIGGER THAT WRITES: definer rights would have let it
-- insert a row for any tenant, and invoker rights cost it nothing. These two
-- only READ, they return a boolean and never a row, and each pins itself to
-- app_current_tenant() and app_current_user() internally — so neither can
-- answer a question about anybody else's workspace, and neither can widen what
-- the caller may see. What they buy is the thing invoker rights cannot give:
-- reading a table WITHOUT running its policy, which is the only way to break
-- the cycle. They are STABLE and take no user-supplied predicate.
--
-- ============================================================================
-- WHAT RLS DOES AND DOES NOT DECIDE HERE
-- ============================================================================
--
-- RLS decides WHETHER a row is visible. It cannot return a redacted row, and
-- app-layer redaction is not an acceptable substitute — a `delete row.title` in
-- one server action is a rule the next surface forgets.
--
-- So the four access levels split across two mechanisms, deliberately:
--
--   details, write   -> the ROW is visible. Ordinary RLS, policies below.
--   busy, titles     -> the row is NOT visible to a direct SELECT at all.
--                       app_schedule_range() returns a PROJECTION instead.
--
-- That is why a `busy` grant appears in no policy below. Somebody with `busy`
-- selecting schedule_items directly gets nothing, which is correct: the columns
-- they may have do not come from the table, they come from the function.

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

-- "May I administer this calendar?" — i.e. rename, share, delete.
--
-- A personal calendar is administered by its owner and by NOBODY else, tenant
-- owners included. That departs from CRM (where an owner sees every record) and
-- follows mail (0043), which gave owners no override over somebody's private
-- correspondence. A calendar is that shape. An owner who needs somebody's
-- schedule gets granted access, which is a row somebody can see and revoke.
--
-- A calendar with NO owner belongs to the business, and the business's owners
-- administer it. That is the case pack-provisioned calendars land in.
CREATE OR REPLACE FUNCTION app_can_admin_calendar(p_calendar_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM schedule_calendars c
     WHERE c.id = p_calendar_id
       AND c.tenant_id = app_current_tenant()
       AND (
         (c.owner_clerk_user_id IS NOT NULL
           AND c.owner_clerk_user_id = app_current_user())
         OR (c.owner_clerk_user_id IS NULL
           AND app_current_tenant_role() = 'owner')
       )
  );
$$;
--> statement-breakpoint

-- "Am I on this item?" — what makes attendance grant sight of the item without
-- granting anything on the calendar around it.
CREATE OR REPLACE FUNCTION app_is_attendee(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM schedule_item_attendees a
     WHERE a.item_id = p_item_id
       AND a.tenant_id = app_current_tenant()
       AND a.clerk_user_id IS NOT NULL
       AND a.clerk_user_id = app_current_user()
  );
$$;
--> statement-breakpoint

-- My access level on a calendar, or NULL for none.
--
-- INVOKER rights on purpose: it reads schedule_shares, whose policy is
-- self-contained, so there is no cycle to break and therefore no reason to
-- reach for definer rights. The one place it must NOT be called is inside
-- schedule_shares' own policies.
CREATE OR REPLACE FUNCTION app_calendar_access(p_calendar_id uuid)
RETURNS schedule_access
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN app_can_admin_calendar(p_calendar_id) THEN 'write'::schedule_access
    ELSE (
      -- ORDER BY ... LIMIT 1 rather than max(): Postgres ships no max()
      -- aggregate for enum types, though they order fine. The highest of a
      -- personal grant and the workspace-wide one wins.
      SELECT s.access
        FROM schedule_shares s
       WHERE s.calendar_id = p_calendar_id
         AND s.tenant_id = app_current_tenant()
         AND (s.grantee_clerk_user_id = ''
           OR s.grantee_clerk_user_id = app_current_user())
       ORDER BY s.access DESC
       LIMIT 1
    )
  END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------
-- schedule_calendars
------------------------------------------------------------------------------

ALTER TABLE "schedule_calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_calendars" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_calendars_superadmin_all ON "schedule_calendars"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- READ. Mine, or one somebody granted me (at any level — the level decides what
-- the READ PATH shows, not whether the calendar exists to me).
--
-- `grantee_clerk_user_id = ''` is the everyone grant. app_current_user()
-- returns NULL when the caller passed no user id, and `x = NULL` is NULL rather
-- than true, so forgetting it denies the personal term and leaves only the
-- workspace-wide one. A forgotten opt-in denies.
CREATE POLICY schedule_calendars_read ON "schedule_calendars"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      ("owner_clerk_user_id" IS NOT NULL
        AND "owner_clerk_user_id" = app_current_user())
      OR EXISTS (
        SELECT 1 FROM "schedule_shares" s
         WHERE s."tenant_id" = "schedule_calendars"."tenant_id"
           AND s."calendar_id" = "schedule_calendars"."id"
           AND (s."grantee_clerk_user_id" = ''
             OR s."grantee_clerk_user_id" = app_current_user())
      )
    )
  );
--> statement-breakpoint

-- WRITE. Yours, or the business's if you are an owner.
--
-- THE TEST IS IN `USING` AS WELL AS `WITH CHECK`. WITH CHECK is not consulted
-- for DELETE (the trap 0067 and 0077 both document), so a policy that tested
-- only there would let anybody delete every calendar in the workspace while
-- being unable to create one.
CREATE POLICY schedule_calendars_write ON "schedule_calendars"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      ("owner_clerk_user_id" IS NOT NULL
        AND "owner_clerk_user_id" = app_current_user())
      OR ("owner_clerk_user_id" IS NULL
        AND app_current_tenant_role() = 'owner')
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND (
      ("owner_clerk_user_id" IS NOT NULL
        AND "owner_clerk_user_id" = app_current_user())
      OR ("owner_clerk_user_id" IS NULL
        AND app_current_tenant_role() = 'owner')
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- schedule_shares — THE SELF-CONTAINED ONE. It reads no other table.
------------------------------------------------------------------------------

ALTER TABLE "schedule_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_shares" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_shares_superadmin_all ON "schedule_shares"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- READ: your own grant, the workspace-wide grant, or every grant on a calendar
-- you administer.
--
-- Seeing your own is what lets somebody be told WHY they can see a calendar.
-- Seeing all of them on your own calendar is the sharing UI. Seeing anybody
-- else's, on a calendar that is not yours, is not offered — a member who could
-- list grants could ask "whose calendar is shared with whom", which is a map of
-- the workspace's private arrangements.
CREATE POLICY schedule_shares_read ON "schedule_shares"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      "grantee_clerk_user_id" = ''
      OR "grantee_clerk_user_id" = app_current_user()
      OR app_can_admin_calendar("calendar_id")
    )
  );
--> statement-breakpoint

-- WRITE: only somebody who administers the calendar. A grantee cannot re-grant,
-- so access never spreads sideways. Test in USING as well — see above.
CREATE POLICY schedule_shares_write ON "schedule_shares"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND app_can_admin_calendar("calendar_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_can_admin_calendar("calendar_id")
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- schedule_items
------------------------------------------------------------------------------

ALTER TABLE "schedule_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_items_superadmin_all ON "schedule_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- READ.
--
-- THE INHERITANCE IS THE POINT: visibility is one EXISTS against
-- schedule_calendars, whose own policy has already decided what this person may
-- see. Nothing about sharing is restated here, so nothing here can drift from
-- it — the same arrangement crm_deals and crm_activities have against
-- crm_party_details.
--
-- `app_calendar_access(...) >= 'details'` is what confines the ROW to the two
-- levels that are grants rather than projections; the enum's declaration order
-- is what makes `>=` mean anything, so do not reorder it. Somebody with `busy`
-- or `titles` sees nothing here and reads app_schedule_range() instead.
--
-- Two terms widen it, and both are narrower than they look:
--   * you administer the calendar (your own items, always)
--   * you are an attendee (an invitation shows you the item and nothing else
--     on the calendar it lives on)
--
-- And `sensitivity = 'private'` narrows it back: a private item on a SHARED
-- calendar reaches the calendar's administrator and its attendees only.
CREATE POLICY schedule_items_read ON "schedule_items"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      app_is_attendee("id")
      OR (
        EXISTS (
          SELECT 1 FROM "schedule_calendars" c
           WHERE c."tenant_id" = "schedule_items"."tenant_id"
             AND c."id" = "schedule_items"."calendar_id"
        )
        AND app_calendar_access("calendar_id") >= 'details'
        AND (
          "sensitivity" = 'normal'
          OR app_can_admin_calendar("calendar_id")
        )
      )
    )
  );
--> statement-breakpoint

-- WRITE: `write` access on the calendar, which administering it implies.
-- A private item still cannot be edited by somebody who only shares the
-- calendar, for the same reason they cannot read it.
CREATE POLICY schedule_items_write ON "schedule_items"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND app_calendar_access("calendar_id") = 'write'
    AND ("sensitivity" = 'normal' OR app_can_admin_calendar("calendar_id"))
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_calendar_access("calendar_id") = 'write'
    AND ("sensitivity" = 'normal' OR app_can_admin_calendar("calendar_id"))
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- schedule_item_attendees
------------------------------------------------------------------------------

ALTER TABLE "schedule_item_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_item_attendees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_item_attendees_superadmin_all ON "schedule_item_attendees"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- Inherits from the item, which inherits from the calendar. This is the edge
-- that must point one way: schedule_items' policy calls app_is_attendee()
-- rather than reading this table, precisely so this may read that one.
CREATE POLICY schedule_item_attendees_read ON "schedule_item_attendees"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_attendees"."tenant_id"
         AND i."id" = "schedule_item_attendees"."item_id"
    )
  );
--> statement-breakpoint

-- Writing the attendee list is editing the item. One exception, added because
-- the alternative is absurd: you may always update YOUR OWN row, which is what
-- accepting or declining an invitation is — and an attendee frequently has no
-- write access to the calendar the item lives on.
CREATE POLICY schedule_item_attendees_write ON "schedule_item_attendees"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      ("clerk_user_id" IS NOT NULL AND "clerk_user_id" = app_current_user())
      OR EXISTS (
        SELECT 1 FROM "schedule_items" i
         WHERE i."tenant_id" = "schedule_item_attendees"."tenant_id"
           AND i."id" = "schedule_item_attendees"."item_id"
           AND app_calendar_access(i."calendar_id") = 'write'
      )
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND (
      ("clerk_user_id" IS NOT NULL AND "clerk_user_id" = app_current_user())
      OR EXISTS (
        SELECT 1 FROM "schedule_items" i
         WHERE i."tenant_id" = "schedule_item_attendees"."tenant_id"
           AND i."id" = "schedule_item_attendees"."item_id"
           AND app_calendar_access(i."calendar_id") = 'write'
      )
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- The projection. What `busy` and `titles` return instead of a row.
------------------------------------------------------------------------------

-- The BELOW-details overlay, and nothing else.
--
-- Scope is deliberately narrow: this returns rows ONLY for calendars where the
-- caller's level is `busy` or `titles`. Everything at `details` or above is an
-- ordinary RLS-scoped SELECT on schedule_items, and so is every item somebody
-- can see by being an attendee. Two mechanisms, each doing the one thing it is
-- good at, rather than one function reimplementing the policies above it and
-- drifting from them.
--
-- src/lib/schedule/range.ts runs both and merges. That is what "one read path"
-- means here — one function callers use, not one query.
--
-- SECURITY DEFINER because it must read rows RLS deliberately refuses; that is
-- the whole feature. It is safe because it never returns a column the caller's
-- level does not carry, the level is computed per row from
-- app_calendar_access() rather than passed in, and the caller supplies two
-- timestamps and nothing else — there is no predicate to inject.
CREATE OR REPLACE FUNCTION app_schedule_range(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  id uuid,
  calendar_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  show_as schedule_show_as,
  access schedule_access,
  title text,
  location text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.calendar_id,
    i.starts_at,
    i.ends_at,
    i.all_day,
    i.show_as,
    lvl.access,
    -- A private item never surfaces its title to a sharee, at any level.
    CASE WHEN lvl.access >= 'titles' AND i.sensitivity = 'normal'
         THEN i.title END,
    CASE WHEN lvl.access >= 'titles' AND i.sensitivity = 'normal'
         THEN i.location END
  FROM schedule_items i
  CROSS JOIN LATERAL (
    SELECT app_calendar_access(i.calendar_id) AS access
  ) lvl
  WHERE i.tenant_id = app_current_tenant()
    AND i.cancelled_at IS NULL
    AND lvl.access IS NOT NULL
    -- The overlay stops where RLS starts. Without this every details-level item
    -- would come back twice, once from each path.
    AND lvl.access < 'details'
    AND i.starts_at < p_to
    AND i.ends_at > p_from;
$$;
