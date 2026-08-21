-- retail_channels, retail_prices, retail_market_days: RLS. Pattern per
-- drizzle/0137_inventory_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, like every other pack table. RLS answers "whose rows are these";
-- which verb needs which role is the pack's own layer, and there the split is
-- sharper than usual: creating a channel and SETTING A PRICE are `owner`,
-- because a price is the number the whole business turns on and is not something
-- whoever is standing at the stall should be able to move. Recording what the
-- pitch cost and how long somebody stood there is `member`, because it is a
-- chore done by the person who stood there.
--
-- WHY PRICES GET THEIR OWN POLICY PAIR RATHER THAN LEANING ON THE CHANNEL'S.
-- `retail_prices` is an effective-dated history, not a settings row: it is the
-- record of what this business charged on a given day, and once sales hang off
-- it in slice 1 it becomes the evidence behind every revenue figure. A price
-- from another tenant appearing here would not merely expose a number — it would
-- silently restate what this farm's own sales were worth.
--
-- Cross-tenant leakage on `retail_market_days` is the quieter one and still
-- real: the whole purpose of the table is to tell a market worth standing at
-- from a dud, and another farm's stall fees would answer that question wrong.

ALTER TABLE "retail_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_channels_superadmin_all ON "retail_channels"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_channels_member_all ON "retail_channels"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "retail_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_prices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_prices_superadmin_all ON "retail_prices"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_prices_member_all ON "retail_prices"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "retail_market_days" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_market_days" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retail_market_days_superadmin_all ON "retail_market_days"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY retail_market_days_member_all ON "retail_market_days"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
