-- Retainer tables: platform-owned (written only by superadmin actions and
-- the verified Stripe credit path); tenant members get an honest read-only
-- view of their own rows — the meter and work log render under withTenant,
-- and a tenant can never forge hours or credits.
ALTER TABLE "retainers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retainers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retainers_superadmin_all ON "retainers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retainers_member_read ON "retainers" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retainer_allotments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retainer_allotments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retainer_allotments_superadmin_all ON "retainer_allotments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retainer_allotments_member_read ON "retainer_allotments" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retainer_time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retainer_time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retainer_time_entries_superadmin_all ON "retainer_time_entries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retainer_time_entries_member_read ON "retainer_time_entries" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retainer_purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retainer_purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retainer_purchases_superadmin_all ON "retainer_purchases"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retainer_purchases_member_read ON "retainer_purchases" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
