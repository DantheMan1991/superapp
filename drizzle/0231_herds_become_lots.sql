-- Slice 8e: every herd becomes a LOT holding what it held.
--
-- `livestock_groups` is being retired. Everything a herd could do, a lot now
-- does — the last of it was the bulk move, which shipped in 8d. **But dropping
-- the tables without this would silently lose real groupings**: Hilltop Farm's
-- "Cows" holds four animals, and after a bare DROP they would be four unrelated
-- rows with nothing saying they belong together.
--
-- THE TABLES ARE NOT DROPPED HERE. Only the data moves, and the code stops
-- reading it. `main` auto-deploys and nothing applies migrations for it, so a
-- DROP in the same release as the code change would take the running app down
-- between the two — ADR 0014's rule, applied to a removal instead of an
-- addition. The DROP is its own migration in its own PR, after this is live.
--
-- WHAT A CONVERTED HERD LOOKS LIKE:
--
--   * an `inventory_lots` row named for the herd, with NO head of its own —
--     the head was always its members' and stays there
--   * a `livestock_lots` row, `record_kind = 'lot'`, taking its species from
--     the first member (a mixed herd picks one; the app shows the real mix by
--     folding over members, so nothing is lost)
--   * one `livestock_lot_members` row per membership, dates carried across
--
-- `source = 'raised'` because a container lot was not bought. It is the least
-- wrong of the three the CHECK allows, and with no head and no cost it never
-- reaches a valuation.
--
-- **THE LINK IS THE HERD'S ID, IN METADATA, NEVER ITS NAME.**
-- `livestock_groups` does not enforce unique names, so two herds called "Cows"
-- would produce two lots coded "Cows" and a name join would cross them —
-- duplicating every membership and tripping the one-open-per-member index.

-- One lot per herd, stamped with where it came from.
WITH rep AS (
  SELECT DISTINCT ON (gm."livestock_group_id")
         gm."livestock_group_id" AS group_id,
         il."item_id"            AS item_id,
         ll."species"            AS species
    FROM "livestock_group_members" gm
    JOIN "livestock_lots"  ll ON ll."id" = gm."livestock_lot_id"
    JOIN "inventory_lots"  il ON il."id" = ll."inventory_lot_id"
   ORDER BY gm."livestock_group_id", gm."started_on", gm."created_at"
),
new_inv AS (
  INSERT INTO "inventory_lots"
         ("tenant_id", "item_id", "code", "source", "notes", "metadata")
  SELECT g."tenant_id", rep."item_id", g."name", 'raised',
         'Was a herd before livestock slice 8e.',
         jsonb_build_object('migratedFromHerd', g."id"::text)
    FROM "livestock_groups" g
    JOIN rep ON rep."group_id" = g."id"
  RETURNING "id", "tenant_id", "metadata"
)
INSERT INTO "livestock_lots"
       ("tenant_id", "inventory_lot_id", "species", "record_kind", "notes")
SELECT ni."tenant_id", ni."id", rep."species", 'lot',
       'Was a herd before livestock slice 8e.'
  FROM new_inv ni
  JOIN rep ON rep."group_id" = (ni."metadata"->>'migratedFromHerd')::uuid;
--> statement-breakpoint

-- Memberships across, parent resolved through that stamp.
--
-- **OPEN MEMBERSHIPS ARE SKIPPED WHERE THE ANIMAL IS ALREADY IN A LOT.** The
-- partial unique index allows one open membership per member, and an animal put
-- into a lot by hand since 8b has the better claim: somebody stated it, and
-- this is inferring it. Closed rows carry across regardless — history does not
-- collide.
--
-- Members that HOLD things are skipped too, for the one-level rule: a herd
-- containing a lot that itself contains animals cannot become a two-level tree.
INSERT INTO "livestock_lot_members"
       ("tenant_id", "parent_lot_id", "member_lot_id", "started_on", "ended_on")
SELECT gm."tenant_id", parent_ll."id", gm."livestock_lot_id",
       gm."started_on", gm."ended_on"
  FROM "livestock_group_members" gm
  JOIN "inventory_lots" parent_il
    ON parent_il."tenant_id" = gm."tenant_id"
   AND (parent_il."metadata"->>'migratedFromHerd')::uuid = gm."livestock_group_id"
  JOIN "livestock_lots" parent_ll
    ON parent_ll."inventory_lot_id" = parent_il."id"
 WHERE
   -- never itself
   parent_ll."id" <> gm."livestock_lot_id"
   -- an animal already placed in a lot by hand keeps that placement
   AND (
     gm."ended_on" IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM "livestock_lot_members" x
        WHERE x."tenant_id" = gm."tenant_id"
          AND x."member_lot_id" = gm."livestock_lot_id"
          AND x."ended_on" IS NULL
     )
   )
   -- one level deep: a member may not itself be holding anything
   AND NOT EXISTS (
     SELECT 1 FROM "livestock_lot_members" y
      WHERE y."tenant_id" = gm."tenant_id"
        AND y."parent_lot_id" = gm."livestock_lot_id"
        AND y."ended_on" IS NULL
   );
