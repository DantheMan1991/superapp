-- Maintenance tables: RLS. Same shape as drizzle/0126_assets_rls.sql — ENABLE +
-- FORCE, superadmin_all, member_all.
--
-- Member-wide for the same reason `assets` is: knowing the tractor is due an
-- oil change is ordinary work, not a capital decision. Who may WRITE is gated
-- in the pack's action layer, and RLS answers only whose rows these are.
--
-- Note these carry `tenant_id` of their own rather than inheriting through
-- `asset_id`. A policy that reached the parent would need a subquery on every
-- row, and the composite foreign keys already guarantee the two agree — an
-- event cannot point at an asset in another tenant, because the FK carries
-- `tenant_id` on both sides.

ALTER TABLE "asset_maintenance_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_maintenance_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ams_superadmin_all ON "asset_maintenance_schedules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY ams_member_all ON "asset_maintenance_schedules"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "asset_meter_readings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_meter_readings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY amr_superadmin_all ON "asset_meter_readings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY amr_member_all ON "asset_meter_readings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "asset_maintenance_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_maintenance_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ame_superadmin_all ON "asset_maintenance_events"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY ame_member_all ON "asset_maintenance_events"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
