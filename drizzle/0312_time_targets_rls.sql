-- time_entry_dimensions: RLS. Pattern per drizzle/0301_time_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, like every other table in this module: RLS
-- answers "whose rows are these", and which verb needs which role is the action
-- layer's business. Tagging an hour is a `staff` chore — the person who did the
-- work knows which field they were in.
--
-- WHAT THIS TABLE CANNOT DO is reach a member of another tenant, and that is
-- the composite FK's job rather than the policy's: the three-column reference
-- carries `tenant_id`, so a cross-tenant tag is unrepresentable even under
-- `withSystem`, where RLS is not watching. The isolation suite proves it.
--
-- FORCEd for the reason every table here is: the app connects as `app_user`,
-- and the policy is the backstop, not the app code.

ALTER TABLE "time_entry_dimensions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_entry_dimensions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entry_dimensions_superadmin_all ON "time_entry_dimensions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_entry_dimensions_member_all ON "time_entry_dimensions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
