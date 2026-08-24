-- The variant and the batch band: the two columns that let the app do the
-- lookup instead of making a person do it.
--
-- ONE REAL CHICKEN RATE SHEET PRICES SLAUGHTER AS A 4-BREED x 6-BAND GRID.
-- 2a modelled that as a menu and put what told the 24 cells apart into the
-- LABEL, which reads correctly on paper and is unreadable to the app: a batch of
-- 800 birds cannot be compared against words. `variant` and
-- `[head_min, head_max]` are those facts as fields.
--
-- BOTH KEY COLUMNS ARE `NOT NULL` AND THAT IS THE WHOLE POINT. They go in the
-- unique index, and Postgres treats two nulls as distinct, so a nullable column
-- in a unique index constrains nothing at all. This repo has been bitten three
-- times — `inventory_count_lines`, `inventory_tax_treatments`, and the note in
-- `inventory.md`. `head_min` defaults to 0, which means "from the first head"
-- and is true of every unbanded row. `head_max` stays OUT of the key rather than
-- being given a sentinel: "no ceiling" is a real answer and 2147483647 is not.
--
-- ── THE INDEX SWAP IS NOT AN EXPAND/CONTRACT, AND IT WAS TRIED ──────────────
--
-- The old index on (tenant, processor, kind, label) is dropped here rather than
-- in a follow-up after the deploy, which is this repo's usual discipline and is
-- not available: the two indexes CANNOT COEXIST usefully. Keeping the old one
-- was written and run, and it refuses the second of any plant's 24 chicken
-- slaughter rows with a duplicate-key error, because that is precisely what it
-- says. An expand-only release would therefore ship a feature that cannot be
-- used and tests that cannot pass, which is worse than what is accepted instead.
--
-- WHAT IS ACCEPTED INSTEAD, STATED PLAINLY: between this migration being applied
-- and the merge deploying, the RUNNING code's `setPriceItem` infers its ON
-- CONFLICT target from the four old columns and will fail with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". That is a few
-- minutes, it affects only writes to a price list — Add a price, and Record on
-- the read dialog — it loses nothing and corrupts nothing, and it is the reason
-- ADR 0014 has the apply happen at a moment somebody is watching.
--
-- EVERYTHING ELSE IS SAFE TO APPLY AHEAD OF THE DEPLOY. Every existing row gets
-- variant '' and head_min 0, so the new index's key is the old one plus two
-- constants and can create no new collision; the CHECK is satisfied by head_max
-- being null everywhere. `production_orders.printed_at` is nullable and nothing
-- reads it until the deploy.
--
-- WHAT `printed_at` IS: the nearest honest thing to "handed over", which the
-- dossier has wanted since 2b and said should be a DATE rather than a status —
-- a status somebody has to advance is a status nobody advances. It is stamped by
-- the print button and by nothing else, so null means "nobody pressed Print
-- here" and never "the plant never got one".

DROP INDEX "production_processor_price_items_unique_idx";--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "printed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD COLUMN "variant" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD COLUMN "head_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD COLUMN "head_max" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_price_items_unique_idx" ON "production_processor_price_items" USING btree ("tenant_id","processor_id","kind","variant","head_min","label");--> statement-breakpoint
ALTER TABLE "production_processor_price_items" ADD CONSTRAINT "production_processor_price_items_band_ordered" CHECK ("production_processor_price_items"."head_min" >= 0 and ("production_processor_price_items"."head_max" is null or "production_processor_price_items"."head_max" >= "production_processor_price_items"."head_min"));