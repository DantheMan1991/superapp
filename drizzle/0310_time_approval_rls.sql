-- time_periods + time_sheets: RLS. Pattern per drizzle/0301_time_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE AT THE ROW LEVEL, as the module's other four tables are: RLS
-- answers "whose rows are these", and which VERB needs which role is the action
-- layer's business. Submitting is a `staff` chore; APPROVING and LOCKING are
-- `owner` decisions, in src/modules/time/actions.ts, behind `roleMayApprove` —
-- the same predicate the screens ask, so the two cannot drift.
--
-- WHY APPROVAL IS NOT AN RLS RULE. It is tempting to make the policy itself
-- refuse a non-owner's UPDATE of `approved_at`, and it would be wrong: a policy
-- names rows, not columns, so the rule would have to forbid staff from touching
-- the row at all — and staff must be able to submit one. The column-level
-- question belongs where the verb is.
--
-- WHAT A COLLEAGUE MAY SEE IS EVERY SHEET, on purpose and consistently with the
-- hours themselves. A timesheet is a shared record on a site or a farm; a
-- business that wanted one person's hours hidden from another needs a
-- visibility model, which is a bigger question than this slice.
--
-- FORCEd for the reason every table here is: the app connects as `app_user`,
-- and the policy is the backstop, not the app code.
--
-- No policy change is needed for `time_entries`: its existing member_all policy
-- covers the `amends_entry_id` column 0309 added, because a policy names rows
-- and not columns. The immutability of a locked period is likewise NOT an RLS
-- rule — it depends on a date range in another table, which a row policy cannot
-- express — so it is `assertPeriodOpen` in `sheet-ops.ts`, called by every
-- write path, and proved by the isolation suite.

ALTER TABLE "time_periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_periods_superadmin_all ON "time_periods"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_periods_member_all ON "time_periods"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "time_sheets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_sheets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_sheets_superadmin_all ON "time_sheets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_sheets_member_all ON "time_sheets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
