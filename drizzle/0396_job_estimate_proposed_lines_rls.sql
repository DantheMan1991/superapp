-- job_estimate_proposed_lines: RLS. Pattern per
-- drizzle/0393_job_estimate_interviews_rls.sql -- ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE, like the walk it belongs to: proposing lines IS the
-- estimating. It cascades from the interview, which cascades from the
-- estimate, so the company-scope policy on job_estimates (ADR 0094) already
-- governs everything reachable here -- and a restrictive clause naming a
-- column this table does not have would hide every row.

ALTER TABLE "job_estimate_proposed_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_proposed_lines_superadmin_all ON "job_estimate_proposed_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_proposed_lines_member_all ON "job_estimate_proposed_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
