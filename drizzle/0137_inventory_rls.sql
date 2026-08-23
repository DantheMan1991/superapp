-- inventory: RLS. Pattern per drizzle/0133_land_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all, one policy pair per table.
--
-- MEMBER-WIDE, and this pack is where that stops being merely convenient. What
-- is in the freezer is not private correspondence: whoever is sent to fetch the
-- ribeyes needs to find them, and at 10x the person recording that four birds
-- died is not the owner. So RLS answers only "whose rows are these", and WHO
-- MAY WRITE is gated in the pack's action layer.
--
-- ALL THREE TABLES, INCLUDING `inventory_movements`. It would have been
-- tempting to let the composite FK to `inventory_items` keep the ledger honest,
-- since a movement has no meaning without its item. That would be depending on
-- a constraint to do a policy's job: FORCE RLS on the ledger is what makes
-- "no context, no rows" true for the movement history as well as for the item —
-- and the movement history is the traceability chain, which is the most
-- sensitive thing this pack holds.

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_items_superadmin_all ON "inventory_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_items_member_all ON "inventory_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "inventory_lots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_lots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_lots_superadmin_all ON "inventory_lots"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_lots_member_all ON "inventory_lots"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_movements_superadmin_all ON "inventory_movements"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_movements_member_all ON "inventory_movements"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
