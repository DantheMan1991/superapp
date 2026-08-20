-- Livestock slice 2 feed tables: RLS. Pattern per drizzle/0139_livestock_rls.sql
-- and 0157 — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE ON ALL THREE, and the reasoning splits by table rather than being
-- uniform by accident:
--
--   * `livestock_feed_groups` is created by an owner — the pack's action layer
--     enforces that, because deciding fifteen pens share one cost pot is a
--     decision about how the farm's largest cash cost is attributed. RLS still
--     answers only "whose rows are these"; which verb needs which role is the
--     pack's business, exactly as it is for `inventory_lots`.
--   * `livestock_feed_group_members` and `livestock_feed_draws` are written by
--     whoever moved the birds and whoever opened the bin. An owner-only policy
--     here would mean the membership DATES — the thing the whole allocation
--     divides by — get recorded days late by somebody who was not there, or not
--     at all.
--
-- `livestock_feed_draws` carries no money of its own. It points at an
-- `inventory_movements` row, which is protected in its own right and FORCEd, so
-- the cost is behind two policies rather than one — and a draw can only ever
-- name a movement of the same tenant, because its foreign key is composite on
-- (tenant_id, id).

ALTER TABLE "livestock_feed_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_feed_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_feed_groups_superadmin_all ON "livestock_feed_groups"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_feed_groups_member_all ON "livestock_feed_groups"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "livestock_feed_group_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_feed_group_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_feed_group_members_superadmin_all ON "livestock_feed_group_members"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_feed_group_members_member_all ON "livestock_feed_group_members"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "livestock_feed_draws" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_feed_draws" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_feed_draws_superadmin_all ON "livestock_feed_draws"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_feed_draws_member_all ON "livestock_feed_draws"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
