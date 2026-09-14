-- job_pay_application_labor: RLS. Pattern per drizzle/0342_cost_plus_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all. The labour lines of a
-- time-and-materials application are the application's, visible to whoever
-- can see the application; the verbs that write them are owner-only in the
-- pack, and so is the read of Time's rates they are priced from (its
-- `time_rates_owner_all`). 0345 adds a column to two existing tables and
-- widens two CHECKs on a third, whose policies are unchanged.

ALTER TABLE "job_pay_application_labor" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_pay_application_labor" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_pay_application_labor_superadmin_all ON "job_pay_application_labor"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_pay_application_labor_member_all ON "job_pay_application_labor"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
