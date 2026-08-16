-- journal_entries.entity_id becomes NOT NULL — the CONTRACT half of ADR 0010
-- slice 1, and it runs AFTER the deploy that writes the column.
--
-- WHY IT COULD NOT SHIP IN `0142`. Migrations go out AHEAD of the deploy, and
-- the deploy running while `0142` landed did not write `entity_id`, so a NOT
-- NULL there would have rejected every invoice issued, bill approved and bank
-- row categorised in that window. `0142` therefore added the column NULLABLE
-- and backfilled it; this closes it once every write path supplies one. Exactly
-- the split `0123` made for its `total = subtotal + tax` CHECK, and the same
-- ordering `0075` and `0088` used in the other direction.
--
-- `src/db/schema/ledger.ts` has declared this column NOT NULL since `0142`, one
-- release ahead of the database on purpose. From here the two agree, and that
-- comment comes off.
--
-- THE BACKFILL RUNS AGAIN FIRST, and it is not belt-and-braces. Rows written
-- between `0142` and the deploy going live have a NULL `entity_id` — nothing
-- was writing the column yet — and they are invisible to every entity-scoped
-- report until this repairs them. It is the same guarded statement as `0142`,
-- so it is a no-op when there is nothing to fix.
--
-- Verified on the app database before this ran: 7 tenants, 7 entities, 7
-- defaults, 12 journal entries, zero nulls, zero rows whose entity belongs to
-- another tenant.

UPDATE "journal_entries" je
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = je."tenant_id"
   AND e."is_default"
   AND je."entity_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "journal_entries" ALTER COLUMN "entity_id" SET NOT NULL;
