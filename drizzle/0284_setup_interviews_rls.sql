-- setup_interviews: RLS. ENABLE + FORCE, superadmin_all, member_all — the
-- pattern every tenant-scoped table in this codebase follows.
--
-- MEMBER-WIDE at the row level, and OWNERS-ONLY in the page and the actions,
-- which is the same division the Getting set up card already makes (ADR 0033:
-- "owners only, decided in the card, not in the sources"). RLS answers "whose
-- rows are these"; which role may walk the interview is the action layer's
-- business, and putting it here as well would be a second opinion that could
-- drift from the first.
--
-- Note what this table is NOT: `interview_sessions`, its public cousin, is
-- platform-level data with a superadmin-only policy because an anonymous
-- visitor has no tenant. This one runs inside a tenant for somebody signed
-- in, so it is scoped like every other tenant table and carries no IP hash.
--
-- FORCEd for the reason every table here is: the app connects as `app_user`,
-- and the policy is the backstop, not the application code.

ALTER TABLE "setup_interviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "setup_interviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY setup_interviews_superadmin_all ON "setup_interviews"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY setup_interviews_member_all ON "setup_interviews"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
