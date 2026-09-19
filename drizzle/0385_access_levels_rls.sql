-- access_levels: RLS, plus the narrowing on memberships that makes an access
-- level worth having (ADR 0093).
--
-- ── WHY THE WRITE SIDE IS OWNERS-ONLY IN THE DATABASE ────────────────────────
--
-- An access level is a capability. If tenant context could write one, the
-- person it restricts could grant themselves everything it takes away, and the
-- only thing standing in the way would be an action remembering to call
-- requireTenantOwner. That is the exact shape drizzle/0085 refused one tier up
-- for memberships.role, and for the same stated reason: withSystem connects as
-- the same app_user and merely sets a GUC, so RLS is the only thing that can
-- tell the owner's own action apart from a member's.
--
-- SELECT is member-wide on purpose. The gate on every request reads the
-- caller's own level, and what you are not allowed to open is not a secret from
-- you. Nothing here is another person's business: the level's name, its notes
-- and its list of keys describe the job, not the people on it.

ALTER TABLE "access_levels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "access_levels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY access_levels_superadmin_all ON "access_levels"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY access_levels_member_select ON "access_levels" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY access_levels_owner_insert ON "access_levels" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY access_levels_owner_update ON "access_levels" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY access_levels_owner_delete ON "access_levels" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint

-- ── AND THE HOLE THIS WOULD OTHERWISE LEAVE WIDE OPEN ────────────────────────
--
-- drizzle/0085 narrowed memberships UPDATE so tenant context cannot touch an
-- owner row or mint an owner. It left every OTHER update on a staff row open,
-- which was correct while the only writable column that meant anything was the
-- accountant flag — a thing the app already refused to anybody but an owner.
--
-- `access_level_id` changes that completely: a staff member who could write
-- their own membership row could set it to null and be unrestricted. Null is
-- deliberately the unrestricted value (it is what lets this ship without
-- changing anybody's access), so the escalation would be one UPDATE wide.
--
-- So the whole policy narrows to owners. Nothing is lost: the ONLY tenant-
-- context writer of this table is setMemberAccountantAction, which is already
-- requireTenantOwner in app code and now has the database agreeing with it.
-- Every other writer — the Clerk membership webhook, reconcileTenantMemberships,
-- tenant-sync, the last-seen stamp — runs under withSystem and is untouched.
--
-- USING still sees the OLD row and WITH CHECK the NEW one, so both halves of
-- 0085 are restated here rather than dropped: an owner row stays unreachable
-- from tenant context, and 'owner' stays a value only withSystem can write.

DROP POLICY IF EXISTS memberships_member_update ON "memberships";
--> statement-breakpoint
CREATE POLICY memberships_member_update ON "memberships" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND "role" <> 'owner'
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "role" IN ('staff', 'expert')
    AND app_current_tenant_role() = 'owner'
  );
