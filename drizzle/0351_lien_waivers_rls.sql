-- job_lien_waivers: RLS. Pattern per drizzle/0349_commitment_change_orders_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: recording that a waiver was
-- asked for or arrived is a chore, not a decision — the decision is the
-- payment, which is Accounting's — so the pack's write level for it is
-- `member`, as the daily log's is. The signed copy is a Documents attachment
-- under Documents' own policy, which inherits the document's visibility.

ALTER TABLE "job_lien_waivers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_lien_waivers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_lien_waivers_superadmin_all ON "job_lien_waivers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_lien_waivers_member_all ON "job_lien_waivers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
