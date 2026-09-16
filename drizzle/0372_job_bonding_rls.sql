-- job_bonds and job_bonding_lines: RLS. Pattern per drizzle/0370_job_back_charges_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is; the VERBS are
-- owner-only (ADR 0078). A bond is a term of the agreement and the line is what
-- the surety will back — both are the owner's, the way a contract's value is.

ALTER TABLE "job_bonds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_bonds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_bonds_superadmin_all ON "job_bonds"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_bonds_member_all ON "job_bonds"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_bonding_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_bonding_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_bonding_lines_superadmin_all ON "job_bonding_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_bonding_lines_member_all ON "job_bonding_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
