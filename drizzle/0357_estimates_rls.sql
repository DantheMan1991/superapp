-- job_estimates, job_estimate_lines: RLS. Pattern per
-- drizzle/0353_selections_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all, on both.
--
-- MEMBER-WIDE at the row level and at the verb: writing an estimate is the
-- estimator's chore, and the estimator is rarely the owner. The acts that
-- move money — accepting one onto a contract, making it the budget or the
-- schedule of values — go through the pack's owner verbs.

ALTER TABLE "job_estimates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimates_superadmin_all ON "job_estimates"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimates_member_all ON "job_estimates"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_lines_superadmin_all ON "job_estimate_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_lines_member_all ON "job_estimate_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
