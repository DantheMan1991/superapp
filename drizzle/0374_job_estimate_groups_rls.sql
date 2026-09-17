-- job_estimate_groups: RLS. Pattern per drizzle/0372_job_bonding_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is, and as
-- job_estimate_lines is: writing an estimate is the estimator's chore
-- (ADR 0069). The verbs that make one money — accept, use as budget, use as
-- schedule of values — are owner-only and stay held by the ops, not here.
-- A group is part of the estimate and carries no visibility of its own: the
-- client sees a group only on a proposal, which is a printed document.

ALTER TABLE "job_estimate_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_groups_superadmin_all ON "job_estimate_groups"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_groups_member_all ON "job_estimate_groups"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
