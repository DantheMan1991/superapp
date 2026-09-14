-- job_daily_logs, job_daily_log_crews: RLS. Pattern per
-- drizzle/0336_job_billing_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all, on both.
--
-- MEMBER-WIDE at the row level, and for once the VERB is member-wide too: a
-- daily log is a chore written by whoever is on the site, and the pack's own
-- write level says `member`. The photos on a day are Documents' rows under
-- Documents' policies; the punch items are Work's under Work's.
--
-- WHAT A COLLEAGUE MAY SEE is who was on site and what happened, which is
-- exactly what a daily report is for.
--
-- NO DELETE POLICY BEYOND THE MEMBER ONE. A day's crews go with the day by
-- cascade; the day goes with the project; a subcontractor named on a day is
-- held by `job_daily_log_crews_party_fk` RESTRICT.

ALTER TABLE "job_daily_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_daily_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_daily_logs_superadmin_all ON "job_daily_logs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_daily_logs_member_all ON "job_daily_logs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_daily_log_crews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_daily_log_crews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_daily_log_crews_superadmin_all ON "job_daily_log_crews"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_daily_log_crews_member_all ON "job_daily_log_crews"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
