-- job_sov_lines, job_pay_applications, job_pay_application_lines: RLS. Pattern
-- per drizzle/0334_job_change_orders_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all, on all three.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Issuing a pay application is an `owner` verb there — it posts an
-- invoice — while reading the schedule and the draws is ordinary work for
-- whoever is running the job.
--
-- WHAT A COLLEAGUE MAY SEE is what the client has been billed and what is held
-- back, the same caution 0328, 0332 and 0334 carry, and the same answer.
--
-- NO DELETE POLICY BEYOND THE MEMBER ONE. A schedule and its applications go
-- when their contract goes, by cascade; a schedule line that has been billed
-- against is held by `job_pay_application_lines_sov_fk` RESTRICT, and an
-- issued application's invoice is voided through Accounting, never deleted.

ALTER TABLE "job_sov_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_sov_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_sov_lines_superadmin_all ON "job_sov_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_sov_lines_member_all ON "job_sov_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_pay_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_pay_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_pay_applications_superadmin_all ON "job_pay_applications"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_pay_applications_member_all ON "job_pay_applications"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_pay_application_lines_superadmin_all ON "job_pay_application_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_pay_application_lines_member_all ON "job_pay_application_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
