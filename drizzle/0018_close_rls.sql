-- Close & accountant tools (session 7): RLS for the two new tables, plus
-- a narrow member UPDATE policy on memberships so the tenant owner can set
-- the "expert" (accountant) flag inside withTenant. Pattern per
-- drizzle/0001_rls.sql: ENABLE + FORCE, superadmin_all, member_all.
-- No new triggers.

ALTER TABLE "period_closes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "period_closes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY period_closes_superadmin_all ON "period_closes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY period_closes_member_all ON "period_closes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "close_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "close_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY close_notes_superadmin_all ON "close_notes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY close_notes_member_all ON "close_notes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- Tenant context could previously only READ memberships (0001). The
-- accountant toggle updates memberships.role from a withTenant tx;
-- owner-only-ness is enforced at the app layer (requireTenantOwner),
-- like every intra-tenant role rule. Precedent: audit_log_member_insert.
CREATE POLICY memberships_member_update ON "memberships" FOR UPDATE
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
