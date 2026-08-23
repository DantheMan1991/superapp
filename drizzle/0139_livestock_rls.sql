-- livestock: RLS. Pattern per drizzle/0137_inventory_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE, and here that is not merely convenient — it is the point.
-- Recording that four birds died is daily work done by whoever is standing in
-- the pen, and at 10x that person is not the owner. RLS answers only "whose
-- rows are these"; who may WRITE is gated in the pack's action layer, which is
-- where the owner-only rule can later be relaxed per verb without touching a
-- policy.
--
-- BOTH TABLES, including `livestock_identifiers`. It carries the official tag
-- that puts the traceability chain onto a processor's paperwork, so "no
-- context, no rows" has to be true of it in its own right rather than by way of
-- its lot's policy.

ALTER TABLE "livestock_lots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_lots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_lots_superadmin_all ON "livestock_lots"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_lots_member_all ON "livestock_lots"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "livestock_identifiers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_identifiers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_identifiers_superadmin_all ON "livestock_identifiers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_identifiers_member_all ON "livestock_identifiers"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
