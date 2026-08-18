-- A fixed asset carries its own company (ADR 0010, the last thing it listed as
-- unbuilt).
--
-- HAND-EDITED THREE WAYS, and each one is a rule this repo has paid for:
--
--   1. drizzle-kit emitted `ALTER TABLE "period_closes" ALTER COLUMN
--      "entity_id" SET NOT NULL` at the top. IT HAS BEEN REMOVED — `0153`
--      already did that on both databases, and it reappeared only because a
--      `--custom` migration does not teach the snapshot what its SQL did. It is
--      idempotent either way; a statement about another table inside a
--      migration named for this one is the kind of thing that gets copied
--      forward and then misread.
--   2. It emitted no backfill. Without one every asset loses the company its
--      depreciation has been landing in, and the next schedule run posts
--      somewhere else.
--   3. It emitted the foreign key BEFORE the backfill, so the constraint would
--      have validated a column of nulls. Reordered.
--
-- The column arrives NULLABLE and stays that way for one release: migrations go
-- out ahead of the deploy, and the build running while this lands does not
-- write it. The contract migration after the deploy closes it.

ALTER TABLE "assets" ADD COLUMN "entity_id" uuid;--> statement-breakpoint

-- BACKFILL: exactly what `entityForDocument` answered at runtime, frozen.
--
-- An asset's company is where its depreciation has ALREADY been posting — the
-- entity of its first `depreciation` entry — and the tenant's default for one
-- that has never posted. Anything else would move existing schedules to a
-- different set of books, which is the one outcome this column exists to
-- prevent.
UPDATE "assets" a
   SET "entity_id" = coalesce(
     (
       SELECT je."entity_id"
         FROM "journal_entries" je
        WHERE je."tenant_id" = a."tenant_id"
          AND je."source" = 'depreciation'
          AND je."source_id" = a."id"
        ORDER BY je."created_at"
        LIMIT 1
     ),
     (
       SELECT e."id"
         FROM "entities" e
        WHERE e."tenant_id" = a."tenant_id"
          AND e."is_default"
     )
   );--> statement-breakpoint

ALTER TABLE "assets" ADD CONSTRAINT "assets_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_tenant_entity_idx" ON "assets" USING btree ("tenant_id","entity_id");
