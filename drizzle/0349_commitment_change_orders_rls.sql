-- job_commitment_change_orders: RLS. Pattern per drizzle/0334_job_change_orders_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, owner-only at the VERB, as the client-side
-- change orders are: approving a change to a subcontract is an `owner` act
-- (it moves what the job has committed), while what a subcontractor's scope
-- has grown by is something the person running the job reads. The change's
-- money is lines in `job_commitment_lines`, already under that table's policy.

ALTER TABLE "job_commitment_change_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_commitment_change_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_commitment_change_orders_superadmin_all ON "job_commitment_change_orders"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_commitment_change_orders_member_all ON "job_commitment_change_orders"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
