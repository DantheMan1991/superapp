-- Share links: RLS for the three new tables. Three different shapes, on
-- purpose — each table has a different owner and a different threat.
--
-- Safe against the running code: all three tables are new, so nothing already
-- deployed reads or writes them (the 0025 lesson).
--
-- One thing RLS deliberately does NOT enforce here: "staff may not share an
-- owners-only folder". The RLS context carries the caller's role, but a share
-- row is not visibility-bearing itself — its ROOT is. That check lives in
-- app code (requireShareRole), and no one should later expect a policy to be
-- doing it.

-- 1. document_shares — ordinary tenant data. Members create and revoke their
--    own links, and the member_all pattern applies (drizzle/0014).
ALTER TABLE "document_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_shares" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_shares_superadmin_all ON "document_shares"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_shares_member_all ON "document_shares"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- 2. document_share_events — EVIDENCE. "Did the inspector ever open the
--    drawings?" is a question that gets asked in a dispute, so members read
--    the log and only trusted server code writes it. member_read pattern per
--    drizzle/0020_retainers_rls.sql.
ALTER TABLE "document_share_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_share_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_share_events_superadmin_all ON "document_share_events"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_share_events_member_read ON "document_share_events" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- 3. public_access_attempts — belongs to no tenant. An attacker guessing
--    tokens is not a tenant's data, and attributing that traffic to whichever
--    tenant they eventually hit would be wrong. Superadmin-only, no member
--    policy at all, per drizzle/0022_health_check_rls.sql.
ALTER TABLE "public_access_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public_access_attempts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_access_attempts_superadmin_all ON "public_access_attempts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
