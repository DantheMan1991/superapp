-- job_bid_packages + job_bid_invitations: RLS. Pattern per
-- drizzle/0393_job_estimate_interviews_rls.sql -- ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE: asking a subcontractor for a number is estimating work, the
-- same as writing the line it will fill. Awarding one is guarded in the ops,
-- not here, because RLS is row-level and not verb-level.
--
-- NO `AS RESTRICTIVE` COMPANY-SCOPE CLAUSE. A package cascades from the
-- project, and job_projects already carries the entity policy (ADR 0094), so
-- everything reachable here is governed by it; a clause naming a column this
-- table does not have would hide every row.
--
-- THE PUBLIC LOOKUP DOES NOT RELY ON ANY OF THIS. `resolveBidInvitation` does
-- the token -> tenant hop under withSystem and NOTHING else, then every read
-- after it runs withTenant at role staff, where these policies govern it.

ALTER TABLE "job_bid_packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_bid_packages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_bid_packages_superadmin_all ON "job_bid_packages"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_bid_packages_member_all ON "job_bid_packages"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_bid_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_bid_invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_bid_invitations_superadmin_all ON "job_bid_invitations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_bid_invitations_member_all ON "job_bid_invitations"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
