-- job_drawing_sets + job_sheets: RLS. Pattern per drizzle/0360_job_phases_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: a job's drawings are kept by
-- whoever runs the job — the office indexes a set the day it arrives — and
-- the FILE beside each sheet is a Documents row under the cabinet's own
-- policy, so a sheet whose file is owners-only is a sheet with nothing to
-- open, never a leak (ADR 0072).

ALTER TABLE "job_drawing_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_drawing_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_drawing_sets_superadmin_all ON "job_drawing_sets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_drawing_sets_member_all ON "job_drawing_sets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_sheets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_sheets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_sheets_superadmin_all ON "job_sheets"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_sheets_member_all ON "job_sheets"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
