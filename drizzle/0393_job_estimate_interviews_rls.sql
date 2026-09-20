-- job_estimate_interviews + its answers: RLS. Pattern per
-- drizzle/0390_job_estimate_outlines_rls.sql -- ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE, and this one is not owner territory at all: walking an
-- estimate IS the estimating work, the same as typing the lines, and the
-- estimate tables it sits over are member-wide for that reason. The OUTLINE
-- is owner-only to write, because deciding how the business prices a job is
-- a decision; using it is a chore.
--
-- NO `AS RESTRICTIVE` COMPANY-SCOPE CLAUSE HERE, although job_estimates has
-- one (ADR 0094). A walk cascades from its estimate, so it is reachable only
-- through a row the entity policy already governs -- and a restrictive clause
-- naming a column this table does not have would be a policy that hides
-- everything. The isolation suite proves the reach, which is the part that
-- matters.

ALTER TABLE "job_estimate_interviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_interviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_interviews_superadmin_all ON "job_estimate_interviews"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_interviews_member_all ON "job_estimate_interviews"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_estimate_interview_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_interview_answers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_interview_answers_superadmin_all ON "job_estimate_interview_answers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_interview_answers_member_all ON "job_estimate_interview_answers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
