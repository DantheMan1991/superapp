-- time_workers + time_entries + time_settings: RLS. Pattern per
-- drizzle/0296_professional_services_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all.
--
-- MEMBER-WIDE AT THE ROW LEVEL, as everywhere else: RLS answers "whose rows are
-- these", and which VERB needs which role is the action layer's business.
-- Managing who the workers are is an `owner` verb there — the list of people
-- the business records hours for is what slice 5 hangs pay rates off — while
-- logging an hour is a `staff` chore done by whoever did the work. See
-- src/modules/time/core/errors.ts, where both predicates live so the screens
-- ask exactly what the gates ask.
--
-- WHAT A COLLEAGUE MAY SEE IS EVERYBODY'S HOURS, on purpose. A timesheet is a
-- shared record — somebody logging an afternoon for three people has to be able
-- to find all three — and a business that wanted one person's hours hidden from
-- another needs a visibility model, which is a bigger question than this slice
-- and one nobody has asked.
--
-- WHAT SOMEBODY IS PAID IS A DIFFERENT QUESTION, and it is deliberately not in
-- these tables. `time_rates` arrives in slice 5 and is expected to carry an
-- owners-only policy in the shape the Documents module's owner folders use,
-- because "everyone can see the hours" and "everyone can see the wage bill" are
-- not the same statement. FORCEd for the reason every table here is: the app
-- connects as `app_user`, and the policy is the backstop, not the app code.

ALTER TABLE "time_workers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_workers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_workers_superadmin_all ON "time_workers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_workers_member_all ON "time_workers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entries_superadmin_all ON "time_entries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_entries_member_all ON "time_entries"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "time_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_settings_superadmin_all ON "time_settings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_settings_member_all ON "time_settings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
