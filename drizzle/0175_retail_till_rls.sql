-- retail_sales, retail_sale_lines, retail_stockouts: RLS. Pattern per
-- drizzle/0173_retail_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, and here it is the whole point. A till is worked by whoever is
-- standing at the stall, and a point of sale only the owner could operate is a
-- point of sale nobody uses. RLS answers "whose rows are these"; setting a PRICE
-- is still `owner` in the pack's own layer, because deciding what to charge and
-- taking the money somebody hands you are different acts.
--
-- THESE ARE THE REVENUE ROWS. `retail_sales` and its lines are what every
-- takings figure, every cash reconciliation and — once slice 2 lands — every
-- settlement match is computed from. A sale leaking across a tenant boundary
-- would not merely expose a number: it would put another business's money in
-- this one's day, and the cash count that is supposed to catch a mistake would
-- report a shortfall that never happened.
--
-- `retail_stockouts` is the quiet one and still worth its own pair: it is the
-- only record anywhere of revenue that was NOT taken, and it exists precisely
-- because nothing else can infer it.

ALTER TABLE "retail_sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_sales" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_sales_superadmin_all ON "retail_sales"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_sales_member_all ON "retail_sales"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "retail_sale_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_sale_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_sale_lines_superadmin_all ON "retail_sale_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_sale_lines_member_all ON "retail_sale_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "retail_stockouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_stockouts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_stockouts_superadmin_all ON "retail_stockouts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_stockouts_member_all ON "retail_stockouts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
