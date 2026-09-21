-- job_measurements and job_estimate_outline_measures: RLS (X7).
--
-- Pattern per drizzle/0390_job_estimate_outlines_rls.sql and
-- drizzle/0396_job_estimate_proposed_lines_rls.sql -- ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- ── ONE OF THESE NEEDS THE COMPANY SCOPE AND ONE DOES NOT ───────────────────
--
-- `job_measurements` hangs off a PROJECT, so it gets the restrictive
-- entity-scope clause every project-hung table in this pack carries
-- (ADR 0094, drizzle/0387_entity_scope_rls.sql) -- written the same way, by
-- looking the project's entity up, because a measurement of a building is a
-- fact about a job somebody may not be allowed to see. The pattern is
-- job_sheets', which is the nearest neighbour: same parent, same clause.
--
-- `job_estimate_outline_measures` hangs off an OUTLINE, which has no company
-- and is the tenant's as a whole -- so it takes the shape its siblings
-- `job_estimate_outline_steps` and `job_estimate_outline_questions` take, and
-- no entity clause. A restrictive policy naming a column this table does not
-- have would hide every row.
--
-- MEMBER-WIDE, both: measuring a building IS the estimating.

ALTER TABLE "job_measurements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_measurements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_measurements_superadmin_all ON "job_measurements"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_measurements_member_all ON "job_measurements"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY job_measurements_entity_scope ON "job_measurements" AS RESTRICTIVE
  USING (EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_measurements"."project_id"
        AND app_entity_allows(p.entity_id)))
  WITH CHECK (EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_measurements"."project_id"
        AND app_entity_allows(p.entity_id)));
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_measures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_measures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_outline_measures_superadmin_all ON "job_estimate_outline_measures"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_outline_measures_member_all ON "job_estimate_outline_measures"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
