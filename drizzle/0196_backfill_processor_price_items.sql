-- The three fee columns on `production_processor_handles`, become rows.
--
-- **EXPAND, NOT SWAP.** `kill_fee_cents`, `cut_wrap_cents_per_lb` and
-- `cut_fee_cents_per_head` are copied here and LEFT WHERE THEY ARE. The code
-- shipping with this migration stops reading them; a later PR drops them, after
-- its deploy. Nothing in the deploy applies migrations and `main` auto-deploys
-- (ADR 0014), so a migration that dropped a column would take the processor
-- page down for the minutes between the migration and the deploy that stopped
-- reading it.
--
-- **THE UNIT IS WHAT EACH COLUMN ALWAYS MEANT**, stated rather than implied:
-- the kill fee was per head, cut-and-wrap was per pound of HANGING weight, and
-- the per-head cutting fee — added on 2026-08-23 when a real poultry sheet
-- proved the per-pound column could not hold a per-bird rate — was per head.
-- That column's whole existence was this backfill's argument in miniature.
--
-- **NULL FEES PRODUCE NO ROW.** An unquoted fee is a question nobody asked, and
-- an item priced at null would say the plant was asked and declined to answer.
-- The label is this app's, not the plant's, which is why they are plain: the
-- plant's own words for these never existed as data, and inventing prose here
-- would put words in a named business's mouth.
--
-- Idempotent on `(tenant_id, processor_id, kind, label)`, so re-running it after
-- somebody has already typed one in leaves theirs alone rather than restating
-- a price they may have corrected.

INSERT INTO "production_processor_price_items"
  ("tenant_id", "processor_id", "kind", "category", "label", "price_cents", "unit")
SELECT "tenant_id", "processor_id", "kind", 'slaughter', 'Slaughter', "kill_fee_cents", 'head'
FROM "production_processor_handles"
WHERE "kill_fee_cents" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "production_processor_price_items"
  ("tenant_id", "processor_id", "kind", "category", "label", "price_cents", "unit")
SELECT "tenant_id", "processor_id", "kind", 'cutting', 'Cut and wrap', "cut_wrap_cents_per_lb", 'hanging_lb'
FROM "production_processor_handles"
WHERE "cut_wrap_cents_per_lb" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "production_processor_price_items"
  ("tenant_id", "processor_id", "kind", "category", "label", "price_cents", "unit")
SELECT "tenant_id", "processor_id", "kind", 'cutting', 'Cutting', "cut_fee_cents_per_head", 'head'
FROM "production_processor_handles"
WHERE "cut_fee_cents_per_head" IS NOT NULL
ON CONFLICT DO NOTHING;
