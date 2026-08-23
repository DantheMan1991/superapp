-- `production_order_lines_price_item_fk`: make ON DELETE SET NULL mean what it
-- says. Exactly the fix `drizzle/0192` applied to the two nesting FKs — read its
-- header first; this is the same trap on a new table.
--
-- The constraint is COMPOSITE, on `(tenant_id, price_item_id)`, and Postgres's
-- bare SET NULL nulls EVERY referencing column — `tenant_id` included, which is
-- NOT NULL. So the declared behaviour cannot happen: deleting a price that an
-- order line quotes does not unlink the line, it fails outright.
--
-- POSTGRES 15's COLUMN LIST — `ON DELETE SET NULL (price_item_id)` — nulls only
-- what it names. Both databases run 18.6.
--
-- WHY NOT CASCADE, which every other FK on this table chose: a line is a
-- SNAPSHOT. It already carries the label, the price, the unit and the minimum as
-- they stood when it was written, and it has to keep carrying them — that is
-- what makes "they charged more than they quoted" answerable a year later.
-- Taking last October's order line away because somebody tidied this year's rate
-- sheet would delete the evidence rather than the reference. `price_item_id` is
-- provenance and nothing else, so losing it costs nothing.
--
-- HAND-WRITTEN, AND IT HAS TO STAY THAT WAY. `.onDelete()` in Drizzle takes an
-- action, not a column list, so the TS declaration says plain `set null` and is
-- a lossy description of the constraint below. The drizzle-kit snapshot already
-- records `"onDelete": "set null"`, so schema and snapshot agree and
-- `db:generate` never tries to revert this. Same arrangement as 0192.

ALTER TABLE "production_order_lines" DROP CONSTRAINT "production_order_lines_price_item_fk";
--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_price_item_fk"
  FOREIGN KEY ("tenant_id", "price_item_id")
  REFERENCES "production_processor_price_items"("tenant_id", "id")
  ON DELETE SET NULL ("price_item_id");
