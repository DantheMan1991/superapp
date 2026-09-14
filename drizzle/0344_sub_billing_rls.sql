-- job_sub_applications, job_sub_application_lines: RLS. Pattern per
-- drizzle/0336_job_billing_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all, on both.
--
-- MEMBER-WIDE at the row level, owner-only at the VERB: a subcontractor's
-- application is money the business owes, and approving it as a bill is a
-- decision (the pack's write level says `owner`), but what a subcontractor
-- has billed on a job is something the person running the job reads. The
-- bill it becomes is Accounting's row under Accounting's policies.

ALTER TABLE "job_sub_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_sub_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_sub_applications_superadmin_all ON "job_sub_applications"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_sub_applications_member_all ON "job_sub_applications"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_sub_application_lines_superadmin_all ON "job_sub_application_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_sub_application_lines_member_all ON "job_sub_application_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
