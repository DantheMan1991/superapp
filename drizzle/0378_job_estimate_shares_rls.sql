-- job_estimate_shares: RLS. Pattern per drizzle/0374_job_estimate_groups_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as every table in this pack is: sending a
-- client their proposal is the estimator's chore, and revoking a link that
-- went to the wrong address must not wait for an owner.
--
-- THE PUBLIC LOOKUP IS NOT A POLICY, AND MUST NEVER BECOME ONE. A visitor at
-- /p/<token> has no tenant context, so no policy here can admit them. The
-- token -> tenant hop runs under `withSystem` and does NOTHING else — it
-- resolves one globally unique token_hash to its row and stops (E5c, ADR
-- 0085, the inbound-email webhook's trust model verbatim). Every read after
-- it, and the one write a client may make, runs under `withTenant` and is
-- therefore governed by the member policy below. Widening that lookup, or
-- adding a policy here that does not name app_current_tenant(), is the single
-- most dangerous change anyone can make to this feature.

ALTER TABLE "job_estimate_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_shares" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_shares_superadmin_all ON "job_estimate_shares"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_shares_member_all ON "job_estimate_shares"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
