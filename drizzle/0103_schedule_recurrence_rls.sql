-- Recurrence: policies for the override table, and the projection function
-- taught about repeating events.
--
-- The policy graph gains one more edge, pointing the same safe way:
--
--   schedule_item_overrides --policy reads--> schedule_items
--
-- `schedule_items` does not read overrides, so there is no cycle and no new
-- SECURITY DEFINER helper. Visibility INHERITS: an occurrence you moved is
-- visible exactly when the series is.

ALTER TABLE "schedule_item_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_item_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_item_overrides_superadmin_all ON "schedule_item_overrides"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY schedule_item_overrides_read ON "schedule_item_overrides"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_overrides"."tenant_id"
         AND i."id" = "schedule_item_overrides"."item_id"
    )
  );
--> statement-breakpoint

-- Moving one occurrence is editing the series, so it needs the same `write`.
-- Test in USING as well as WITH CHECK — WITH CHECK is not consulted for DELETE
-- (0067, 0077), and without it a read-only sharee could delete every exception
-- and silently un-cancel meetings that were called off.
CREATE POLICY schedule_item_overrides_write ON "schedule_item_overrides"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_overrides"."tenant_id"
         AND i."id" = "schedule_item_overrides"."item_id"
         AND app_calendar_access(i."calendar_id") = 'write'
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "schedule_items" i
       WHERE i."tenant_id" = "schedule_item_overrides"."tenant_id"
         AND i."id" = "schedule_item_overrides"."item_id"
         AND app_calendar_access(i."calendar_id") = 'write'
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- app_schedule_range, taught about repeating events.
--
-- ============================================================================
-- WHY THIS FUNCTION CANNOT EXPAND A SERIES, AND MUST NOT TRY.
-- ============================================================================
--
-- Expanding an RRULE means walking LOCAL DATES and converting each one with the
-- zone's offset at that instant — the whole reason
-- `src/lib/timezone.ts:zonedTimeToInstant` exists, and the reason a weekly 8am
-- meeting stays 8am across a DST change. Reimplementing that in SQL would be a
-- second copy of the hardest logic in the module, and the two would drift.
--
-- So this returns the SERIES ROW, with its rule and zone attached, and
-- `src/lib/schedule/range.ts` expands it in TypeScript — the same code path
-- that expands the rows RLS returns directly. One expander, two sources.
--
-- The consequence for the WHERE clause: a recurring series whose FIRST
-- occurrence is long before the window must still be returned, or the expander
-- never sees it. Hence the `recurrence_rule <> ''` branch, which drops the
-- `ends_at > p_from` test and lets the expander do the precise filtering.
------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_schedule_range(timestamptz, timestamptz);--> statement-breakpoint

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
  location text,
  time_zone text,
  recurrence_rule text
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
    CASE WHEN lvl.access >= 'titles' AND i.sensitivity = 'normal'
         THEN i.title END,
    CASE WHEN lvl.access >= 'titles' AND i.sensitivity = 'normal'
         THEN i.location END,
    i.time_zone,
    i.recurrence_rule
  FROM schedule_items i
  CROSS JOIN LATERAL (
    SELECT app_calendar_access(i.calendar_id) AS access
  ) lvl
  WHERE i.tenant_id = app_current_tenant()
    AND i.cancelled_at IS NULL
    AND lvl.access IS NOT NULL
    AND lvl.access < 'details'
    AND i.starts_at < p_to
    AND (i.recurrence_rule <> '' OR i.ends_at > p_from);
$$;
