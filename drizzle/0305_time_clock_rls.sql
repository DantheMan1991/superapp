-- time_punches: RLS. Pattern per drizzle/0301_time_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE AT THE ROW LEVEL, as the module's other three tables are: RLS
-- answers "whose rows are these", and which VERB needs which role is the action
-- layer's business. Starting and stopping a clock is a `staff` chore — a
-- supervisor clocking a group in is the ordinary case — while the rounding
-- policy those punches are measured by is an owner's, in
-- src/modules/time/actions.ts.
--
-- EVERYBODY SEES EVERY RUNNING CLOCK, deliberately. A clock left running is a
-- problem for whoever notices it, and the person it belongs to is by definition
-- not looking at the screen. FORCEd for the reason every table here is: the app
-- connects as `app_user`, and the policy is the backstop, not the app code.
--
-- No policy change is needed for `time_entries` or `time_settings`: their
-- existing member_all policies cover the columns 0302 added, because a policy
-- names rows and not columns.

ALTER TABLE "time_punches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_punches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_punches_superadmin_all ON "time_punches"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_punches_member_all ON "time_punches"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
