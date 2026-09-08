-- livestock_advisor_threads + livestock_advisor_messages: RLS. Pattern per
-- drizzle/0139_livestock_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in this pack: RLS answers "whose
-- rows are these", and which PERSON may read which thread is the ops'
-- business — every read in src/packs/livestock/ai/threads.ts is scoped to the
-- asker's clerk_user_id. What a thread holds is what somebody asked about
-- their own farm and what the advisor said back, built from the digest that
-- every member can already see; the boundary that matters is the tenant's.
--
-- FORCEd for the reason every table in the pack is: the app connects as
-- `app_user`, and the policy is the backstop, not the application code.

ALTER TABLE "livestock_advisor_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_advisor_threads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_advisor_threads_superadmin_all ON "livestock_advisor_threads"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_advisor_threads_member_all ON "livestock_advisor_threads"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "livestock_advisor_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_advisor_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_advisor_messages_superadmin_all ON "livestock_advisor_messages"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_advisor_messages_member_all ON "livestock_advisor_messages"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
