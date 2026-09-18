-- job_assemblies + job_assembly_lines: RLS. Pattern per
-- drizzle/0378_job_estimate_shares_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is. Saving an item
-- as an assembly is the estimator's own chore, and a library only an owner
-- could add to is a library nobody adds to.
--
-- AN ASSEMBLY BELONGS TO THE TENANT, NOT TO A JOB. It is the one thing in
-- estimating that outlives the estimate it came from, which is the whole point
-- of it — and the reason its rows carry no project: they would be a lie about
-- where the next one is going.

ALTER TABLE "job_assemblies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_assemblies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_assemblies_superadmin_all ON "job_assemblies"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_assemblies_member_all ON "job_assemblies"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_assembly_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_assembly_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_assembly_lines_superadmin_all ON "job_assembly_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_assembly_lines_member_all ON "job_assembly_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
