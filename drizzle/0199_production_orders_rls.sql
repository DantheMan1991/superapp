-- production_orders + production_order_lines: RLS. Pattern per
-- drizzle/0169_production_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, and here the pack's own layer agrees rather than being stricter:
-- writing a cut sheet is MEMBER, unlike the price list it quotes from. Recording
-- what a plant charges is the terms of a commercial relationship; choosing which
-- of those options you want this time is a working decision made with a customer
-- on the phone, and on a half-beef sale the design says it is the CUSTOMER's
-- choice rather than the farm's at all.
--
-- WHAT A LEAK WOULD BE HERE is narrower than the rate sheet's and worse in one
-- respect: a line says what one named customer asked for on one date, at a price
-- that farm negotiated. The order carries both halves — somebody else's terms
-- and somebody else's customer.
--
-- Cascade deletes reach an order from THREE sides (the processor, the booking
-- and the run) and a line from one, so nothing can outlive the day it was
-- written for.

ALTER TABLE "production_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_orders_superadmin_all ON "production_orders"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_orders_member_all ON "production_orders"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "production_order_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_order_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_order_lines_superadmin_all ON "production_order_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_order_lines_member_all ON "production_order_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
