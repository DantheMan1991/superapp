-- Row-Level Security: the highest-stakes control in the platform.
--
-- Model:
--   * app.role      = 'superadmin' → full visibility (platform owner / system sync)
--   * app.role      = 'member' AND app.tenant_id = <uuid> → that tenant's rows only
--   * no context set → NO rows visible (default-deny, even for the table owner
--     thanks to FORCE ROW LEVEL SECURITY)
--
-- These settings are transaction-local (set_config(..., true)) and are only
-- ever set by src/db/index.ts helpers after authorization checks.

CREATE OR REPLACE FUNCTION app_is_superadmin() RETURNS boolean AS $$
  SELECT current_setting('app.role', true) = 'superadmin';
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_superadmin_all ON "tenants"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY tenants_member_read ON "tenants" FOR SELECT
  USING ("id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_superadmin_all ON "profiles"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY profiles_member_read ON "profiles" FOR SELECT
  USING (
    current_setting('app.role', true) = 'member'
    AND EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."profile_id" = "profiles"."id"
        AND m."tenant_id" = app_current_tenant()
    )
  );
--> statement-breakpoint

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_superadmin_all ON "memberships"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY memberships_member_read ON "memberships" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "modules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY modules_superadmin_all ON "modules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY modules_authed_read ON "modules" FOR SELECT
  USING (current_setting('app.role', true) IN ('member', 'superadmin'));
--> statement-breakpoint

ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_modules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_modules_superadmin_all ON "tenant_modules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY tenant_modules_member_read ON "tenant_modules" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscriptions_superadmin_all ON "subscriptions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY subscriptions_member_read ON "subscriptions" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "tenant_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_notes_superadmin_all ON "tenant_notes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_superadmin_all ON "audit_log"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY audit_log_member_read ON "audit_log" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY audit_log_member_insert ON "audit_log" FOR INSERT
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "hello_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hello_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY hello_items_superadmin_all ON "hello_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY hello_items_member_all ON "hello_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
