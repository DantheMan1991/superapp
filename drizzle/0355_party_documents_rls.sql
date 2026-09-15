-- job_party_documents: RLS. Pattern per drizzle/0351_lien_waivers_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: recording that a
-- subcontractor's certificate arrived, and when it runs out, is the office's
-- chore, as a lien waiver is; the decision it protects — paying, or issuing
-- the order — is Accounting's and an owner's. The scanned copy is a
-- Documents attachment under Documents' own policy.

ALTER TABLE "job_party_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_party_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_party_documents_superadmin_all ON "job_party_documents"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_party_documents_member_all ON "job_party_documents"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
