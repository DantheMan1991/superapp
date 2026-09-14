-- job_cost_code_sets + job_cost_codes + job_projects: RLS. Pattern per
-- drizzle/0296_professional_services_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Creating a project and editing the chart of cost are `owner` verbs
-- there — they are decisions, and `upsertDimensionMember` requires an owner
-- anyway, so a staff-created project could not sync its cost object and would
-- be invisible to every report. Reading the job list is ordinary work for
-- anybody who has to go and stand on the site. See src/lib/packs/authorize.ts.
--
-- WHAT A COLLEAGUE MAY SEE IS THE WHOLE PROJECT, on purpose and worth saying
-- out loud for this pack in particular. A job's value, its client and its dates
-- ride along, and on a construction project those are the numbers people are
-- most often told not to discuss. A business that wanted them hidden from its
-- own field staff would need a per-project visibility model — a bigger question
-- than this slice, and one nobody has asked. Documents already has the
-- owners-only folder for the genuinely private paperwork, which is where a
-- contract with a price in it belongs today.
--
-- FORCEd for the reason every table here is: the app connects as `app_user`,
-- Neon's owner role has BYPASSRLS and must never be what the app uses, and the
-- policy is the backstop rather than the app code.

ALTER TABLE "job_cost_code_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_cost_code_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_cost_code_sets_superadmin_all ON "job_cost_code_sets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_cost_code_sets_member_all ON "job_cost_code_sets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_cost_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_cost_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_cost_codes_superadmin_all ON "job_cost_codes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_cost_codes_member_all ON "job_cost_codes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_projects_superadmin_all ON "job_projects"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_projects_member_all ON "job_projects"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
