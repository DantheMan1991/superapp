-- The meat already in the freezer.
--
-- Slice 1d stamps each output lot with how its run was inspected, as the lot
-- lands, so the fact travels with the meat instead of having to be re-derived
-- from a plant's paperwork a year later. `completeRun` does that from now on —
-- but every lot that landed BEFORE it shipped has an empty `metadata`, and 0190
-- backfilled the RUN's inspection without touching them.
--
-- **THAT HALF-STAMPED STATE IS THE DANGEROUS ONE.** `retail`'s channel guardrail
-- is the next consumer of this, and the design calls it existential: *"Selling
-- uninspected product through the wrong channel can end a poultry enterprise."*
-- A reader that finds the key on newer lots and nothing on older ones has to
-- guess what an absent key means, and the two available guesses are "inspected"
-- and "not inspected" — one of which is the enterprise-ending answer. So the
-- older lots get the same stamp, from the same source of truth.
--
-- IDEMPOTENT, and deliberately: `NOT (metadata ? 'production')` means re-running
-- this changes nothing, and — more importantly — it can never overwrite a stamp
-- the application wrote. The migration is filling a gap, not asserting an
-- authority over lots that already have an answer.
--
-- Runs still open have `inspection IS NULL` and are skipped: nothing has landed
-- from them, so there is no lot to stamp.

UPDATE "inventory_lots" AS l
SET "metadata" = l."metadata" || jsonb_build_object(
      'production',
      jsonb_build_object('inspection', r."inspection", 'runId', r."id"::text)
    )
FROM "production_run_outputs" AS o
JOIN "production_runs" AS r
  ON r."id" = o."run_id" AND r."tenant_id" = o."tenant_id"
WHERE o."lot_id" = l."id"
  AND o."tenant_id" = l."tenant_id"
  AND r."inspection" IS NOT NULL
  AND NOT (l."metadata" ? 'production');
