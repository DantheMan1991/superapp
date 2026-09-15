-- job_phases: RLS. Pattern per drizzle/0357_estimates_rls.sql — ENABLE +
-- FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: a job's schedule is kept by
-- whoever runs the job, and the calendar item beside each phase is on a
-- business calendar shared with everyone at write (ADR 0071).

ALTER TABLE "job_phases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_phases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_phases_superadmin_all ON "job_phases"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_phases_member_all ON "job_phases"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
