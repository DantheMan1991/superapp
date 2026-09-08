-- livestock_breedings + livestock_breeding_checks: RLS. Pattern per
-- drizzle/0139_livestock_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in this pack: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Recording that the bull went in, and what the vet found, are
-- `member` verbs there — chores done by whoever was in the field.
--
-- The window reaches every female living in the pen through
-- `livestock_lot_members`, the same walk a treatment in the water makes. A
-- row from another farm would not merely be visible: it would put a due date
-- on this farm's cows. FORCEd for the reason every table in the pack is —
-- the app connects as `app_user`, and the policy is the backstop, not the
-- application code.

ALTER TABLE "livestock_breedings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_breedings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_breedings_superadmin_all ON "livestock_breedings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_breedings_member_all ON "livestock_breedings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "livestock_breeding_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_breeding_checks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_breeding_checks_superadmin_all ON "livestock_breeding_checks"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_breeding_checks_member_all ON "livestock_breeding_checks"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
