-- A place things are kept is a property of the ASSET.
--
-- Found by driving inventory on 2026-08-19: `listLocations` returned every
-- active asset, so the "Where" picker offered a gate and a tractor as places to
-- put chickens. `land` fixed the same shape for structures with a config-driven
-- KIND filter, and that remedy does not transfer here — on the live tenant a
-- chest freezer and a tractor are both `equipment`, and a garage and a gate are
-- both `building`. Any kind rule either admits the tractor or excludes the
-- freezer, and the freezer is the canonical inventory location.
--
-- Additive and defaulted, so it goes out AHEAD of the deploy in the ordinary
-- direction: the running build does not write the column and does not care that
-- it exists.

ALTER TABLE "assets" ADD COLUMN "is_storage_location" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- BACKFILL, in two halves, because `false` everywhere would empty a picker that
-- people are already using and give them no obvious way to refill it.
--
--  1. EVIDENCE. Anything already used as a location in the movement ledger IS
--     one — that is a fact about what the business does, not a guess.
--  2. A SENSIBLE DEFAULT for the rest: `building` and `infrastructure` are
--     things you put up and then put something inside, which is exactly the
--     default `land` chose for structures. Equipment and vehicles are excluded,
--     so a tractor drops off the list while a garage stays on it.
--
-- A freezer recorded as `equipment` is therefore caught by (1) if it has been
-- used and by the checkbox otherwise, which is the whole reason this is a column
-- and not a kind rule.
UPDATE "assets" a
   SET "is_storage_location" = true
 WHERE a."kind" IN ('building', 'infrastructure')
    OR EXISTS (
         SELECT 1
           FROM "inventory_movements" m
          WHERE m."tenant_id" = a."tenant_id"
            AND m."location_asset_id" = a."id"
       );
