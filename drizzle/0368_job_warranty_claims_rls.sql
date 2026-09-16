-- job_warranty_claims: RLS. Pattern per drizzle/0364_job_sheet_markups_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: a claim is recorded by
-- whoever takes the call and decided by whoever goes to look, and the work
-- it raises is an ordinary Work item under Work's own policy (ADR 0076).
-- The warranty PERIOD is a column on job_projects and moves under that
-- table's policy; the op keeps it to owners.

ALTER TABLE "job_warranty_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_warranty_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_warranty_claims_superadmin_all ON "job_warranty_claims"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_warranty_claims_member_all ON "job_warranty_claims"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
