-- job_pay_application_costs: RLS. Pattern per drizzle/0336_job_billing_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all. The cost lines of a cost-plus
-- application are the application's, visible to whoever can see the
-- application; the verb that writes them is owner-only in the pack, like
-- every other billing verb. 0341 added columns to three existing tables,
-- whose policies already cover them.

ALTER TABLE "job_pay_application_costs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_pay_application_costs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_pay_application_costs_superadmin_all ON "job_pay_application_costs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_pay_application_costs_member_all ON "job_pay_application_costs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
