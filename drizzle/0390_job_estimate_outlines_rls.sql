-- job_estimate_outlines + its steps and questions: RLS. Pattern per
-- drizzle/0380_job_assemblies_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is. The screen is
-- owner-only to WRITE, in application code, because the order a business
-- prices a job in is a decision and not a chore — but an estimator has to be
-- able to READ the outline they are being walked through, and a row-level
-- policy cannot tell reading from writing.
--
-- NO `AS RESTRICTIVE` COMPANY-SCOPE CLAUSE, unlike job_estimates (ADR 0094).
-- An outline belongs to the TENANT and to no company, exactly as a cost code
-- list and an assembly do — it is the reference data a business walks every
-- job with, whichever of its companies the job is under. Scoping it to an
-- entity would mean a business with two companies keeping two copies of the
-- same questions, and the first edit to one would silently be the only one.

ALTER TABLE "job_estimate_outlines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_outlines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_outlines_superadmin_all ON "job_estimate_outlines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_outlines_member_all ON "job_estimate_outlines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_steps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_outline_steps_superadmin_all ON "job_estimate_outline_steps"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_outline_steps_member_all ON "job_estimate_outline_steps"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_questions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_questions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_outline_questions_superadmin_all ON "job_estimate_outline_questions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_outline_questions_member_all ON "job_estimate_outline_questions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
