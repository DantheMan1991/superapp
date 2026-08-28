-- Slice 8c: say which existing records are ONE ANIMAL.
--
-- `record_kind` defaults to 'lot' because the group shape is the older
-- behaviour, so every row that arrived before this migration claims to be a
-- group. Most are. The ones that are not were created by `startIndividual` or
-- `splitIntoIndividuals`, and neither recorded the distinction — it was thrown
-- away at the form and re-derived on every screen as "balance = 1".
--
-- SO THE BACKFILL USES THAT SAME RULE, ONCE. Head balance of exactly one means
-- one animal. It is the rule the app has been applying live, so this changes no
-- screen's answer on the day it runs — it only stops the answer moving
-- afterwards, which is the whole point of the column:
--
--   * a pen of three that loses two stays a lot, instead of becoming an animal
--   * a breeding cow at zero head stays an animal, instead of becoming a lot
--
-- Deliberately NOT keyed on having a name identifier. `splitIntoIndividuals`
-- lets somebody tag by visual, official, EID or tattoo instead of name, and an
-- animal wearing an ear tag rather than a name is still an animal.
--
-- Zero-head rows are LEFT AS LOTS by this rule, which is wrong for exactly one
-- kind of row: an animal that has died or been sold. That is history, her page
-- is a record rather than a working screen, and inventing a kind for her from a
-- balance of zero would be the same guessing this column exists to end.

UPDATE "livestock_lots" ll
   SET "record_kind" = 'animal'
 WHERE (
         SELECT COALESCE(SUM(m."quantity"), 0)
           FROM "inventory_movements" m
          WHERE m."tenant_id" = ll."tenant_id"
            AND m."lot_id" = ll."inventory_lot_id"
       ) = 1;
