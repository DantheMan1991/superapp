-- job_back_charges: RLS. Pattern per drizzle/0368_job_warranty_claims_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is; the VERBS are
-- owner-only, the way every verb that moves money on a subcontract already is
-- (ADR 0077). A back-charge reduces what somebody is paid, so raising, editing,
-- voiding and deducting one are all the owner's.

ALTER TABLE "job_back_charges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_back_charges" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_back_charges_superadmin_all ON "job_back_charges"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_back_charges_member_all ON "job_back_charges"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
