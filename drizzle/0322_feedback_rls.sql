-- feedback_reports + feedback_messages: RLS. ENABLE + FORCE on both.
--
-- ============================================================================
-- THE POSTURE IS `push_devices` (0262) AND `device_grants` (0320), NOT AN
-- ORDINARY TENANT TABLE
-- ============================================================================
--
-- Your own rows in your own tenant: `app_current_tenant()` AND
-- `app_current_user()` together. No tier of membership reaches somebody else's
-- report — an OWNER cannot read their staff's, and that is deliberate rather
-- than an omission.
--
-- The reason is not isolation, which the tenant clause already gives. It is
-- that the box says "tell us what is wrong", and people answer that honestly
-- only when they are not writing in front of their employer. A workspace-wide
-- policy would cut duplicate reports and cost us the reports worth having.
-- ADR 0053 records the trade and the thing that makes it safe to take: this is
-- the LOOSENABLE direction. Letting owners in later is one added clause;
-- taking the workspace back out after somebody has typed a complaint about
-- their boss is not a migration, it is an apology.
--
-- `app_current_user()` IS NULL WHEN NO USER WAS SET, and NULL = anything is
-- not true, so a caller who opened a transaction without a user sees nothing
-- rather than everything (src/db/index.ts, drizzle/0043). That is what makes
-- the clause safe to lean on, and it is why `withTenant` writes "" rather than
-- leaving the setting to whatever the pooled backend held last.
--
-- ============================================================================
-- THE CONSOLE IS NOT A TENANT, AND DOES NOT APPEAR HERE
-- ============================================================================
--
-- Answering a report is `withSystem` after `requireSuperAdmin()` — the shape
-- `/admin/audit` already has — so the superadmin policy below is the whole of
-- the operator's access. There is no cross-tenant read policy and there must
-- never be one: a client-side session that could see another workspace's
-- reports is the same bug as seeing their ledger.
--
-- ============================================================================
-- `internal` IS THE ONE CLAUSE THAT MATTERS MOST
-- ============================================================================
--
-- An operator's private note sits in `feedback_messages` in thread order,
-- which means a row the client must never read lives in a table the client
-- reads. `internal = false` in the SELECT policy is what separates them.
--
-- It is guarded three ways: this clause, a CHECK that refuses an internal
-- message on the client's side at all, and `tests/isolation/feedback.test.ts`,
-- which writes a note as the operator and asserts the reporter's own
-- transaction cannot see it. The application's read path restates the filter
-- in SQL as well. If that test is ever deleted, this column is a leak.
--
-- ============================================================================
-- WHAT A CLIENT MAY AND MAY NOT WRITE
-- ============================================================================
--
--   * INSERT a report, and reply to their own: yes.
--   * UPDATE a report: yes, but the app only ever moves `client_read_at`
--     through it. `status` is NOT protected by a policy — a row-level rule
--     cannot see which COLUMN changed — so the refusal lives in the server
--     action, which is the only writer and never takes a status from the
--     client. The same arrangement `tenants.labels` has, and recorded here so
--     nobody assumes the database is checking it.
--   * UPDATE or DELETE a message: NO POLICY AT ALL. A conversation is not a
--     thing either side may rewrite — `audit_log`'s append-only posture, and
--     `device_grant_uses`'. Editing a sentence somebody has already answered
--     makes the thread a lie.
--   * DELETE a report: no policy either. A report withdrawn is a report
--     `declined`, said out loud by the console. Nothing in the product hard
--     deletes a conversation; the row goes when the tenant does, by cascade.

ALTER TABLE "feedback_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY feedback_reports_superadmin_all ON "feedback_reports"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint
CREATE POLICY feedback_messages_superadmin_all ON "feedback_messages"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

------------------------------------------------------------------------------
-- Reports: the reporter's own.
------------------------------------------------------------------------------
CREATE POLICY feedback_reports_own_select ON "feedback_reports" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );--> statement-breakpoint

CREATE POLICY feedback_reports_own_insert ON "feedback_reports" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );--> statement-breakpoint

-- Marking the thread read. WITH CHECK repeats USING so that a row cannot be
-- updated INTO somebody else's name — without it, a client could hand their
-- own report to another user id and lose sight of it.
CREATE POLICY feedback_reports_own_update ON "feedback_reports" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );--> statement-breakpoint

------------------------------------------------------------------------------
-- Messages: the thread of a report that is theirs, minus the internal notes.
--
-- The EXISTS is written out in full rather than leaning on RLS applying to the
-- subquery's own table. It DOES apply — `app_user` holds no BYPASSRLS, which
-- is the whole reason `db:create-role` exists — but a policy whose correctness
-- depends on a second policy in another file is one refactor away from being
-- wrong, and this is not the table to be clever on. `work_items` inherits from
-- `work_lists` the same explicit way (drizzle/0105).
------------------------------------------------------------------------------
CREATE POLICY feedback_messages_own_select ON "feedback_messages" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND "internal" = false
    AND EXISTS (
      SELECT 1 FROM "feedback_reports" r
      WHERE r."id" = "feedback_messages"."report_id"
        AND r."tenant_id" = app_current_tenant()
        AND r."clerk_user_id" = app_current_user()
    )
  );--> statement-breakpoint

-- Replying. `side = 'client'` is a policy term, not just a CHECK: without it a
-- client could post a message that renders in the console as ours.
CREATE POLICY feedback_messages_own_insert ON "feedback_messages" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "side" = 'client'
    AND "internal" = false
    AND "clerk_user_id" = app_current_user()
    AND EXISTS (
      SELECT 1 FROM "feedback_reports" r
      WHERE r."id" = "feedback_messages"."report_id"
        AND r."tenant_id" = app_current_tenant()
        AND r."clerk_user_id" = app_current_user()
    )
  );
