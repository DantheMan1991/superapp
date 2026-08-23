-- production_processor_price_items: RLS. Pattern per drizzle/0169_production_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the RLS layer, as every table in this pack is, because RLS
-- answers only "whose rows are these". The pack's own layer keeps the WRITES at
-- owner, alongside the handle and the cut rows and for the same reason: these
-- are the terms of a commercial relationship with a named local business.
--
-- A ROW CROSSING A TENANT BOUNDARY WOULD LEAK ONE FARM'S NEGOTIATED PRICE TO
-- ANOTHER, and that is a worse leak here than on the handle row it came out of.
-- A handle carried one fee; this carries the whole rate sheet, line by line,
-- with the plant's own words on it — which is precisely the document a farm is
-- not supposed to be able to read over its neighbour's shoulder.
--
-- The cascade reaches it from the processor, so a price can never outlive the
-- plant it was quoted by.

ALTER TABLE "production_processor_price_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_processor_price_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_processor_price_items_superadmin_all ON "production_processor_price_items"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_processor_price_items_member_all ON "production_processor_price_items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
