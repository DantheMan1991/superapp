-- job_rooms: RLS (X8).
--
-- Pattern per drizzle/0408_job_measurements_rls.sql -- ENABLE + FORCE,
-- superadmin_all, member_all, plus the restrictive company scope every
-- project-hung table in this pack carries (ADR 0094).
--
-- A room is a fact about a JOB, so it is scoped the way the job is: somebody
-- who may not see the project may not see its rooms. Member-wide to write,
-- because listing the rooms in a house is the estimating, not a decision
-- about how the business prices.
--
-- `job_measurements` needs nothing new here. It already has its own
-- entity-scope policy through `project_id`, and a room cannot belong to a
-- project the writer could not reach.

ALTER TABLE "job_rooms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_rooms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_rooms_superadmin_all ON "job_rooms"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_rooms_member_all ON "job_rooms"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY job_rooms_entity_scope ON "job_rooms" AS RESTRICTIVE
  USING (EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_rooms"."project_id"
        AND app_entity_allows(p.entity_id)))
  WITH CHECK (EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_rooms"."project_id"
        AND app_entity_allows(p.entity_id)));
