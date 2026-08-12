-- Fold recurring_invoices into recurring_entries.
--
-- EXPAND half of an expand/contract. Nothing is dropped here: recurring_invoices
-- and invoices.recurring_invoice_id both survive this deploy, because a DROP
-- must FOLLOW the deploy that stops selecting the column, never precede it
-- (docs/conventions.md 4, and drizzle/0075's lesson). The contract half is a
-- separate migration in a separate PR.
--
-- Ids are PRESERVED. A recurring template's id may already be recorded on
-- invoices it generated, so reusing it keeps those links meaningful and makes
-- the backfill of invoices.recurring_entry_id a straight copy rather than a
-- lookup through a mapping table.
--
-- Idempotent: re-running inserts nothing, so this is safe on an environment
-- that has already been migrated by hand.

INSERT INTO "recurring_entries" (
  "id", "tenant_id", "kind", "name", "customer_id", "template",
  "day_of_month", "next_run_date", "auto_post", "is_active",
  "last_generated_at", "created_by_clerk_user_id", "version",
  "created_at", "updated_at"
)
SELECT
  ri."id",
  ri."tenant_id",
  'invoice',
  ri."name",
  ri."customer_id",
  -- The old template was {lines, memo, dueInDays} with no discriminator; the
  -- unified one is a tagged union, so the tag is added on the way across.
  ri."template" || jsonb_build_object('kind', 'invoice'),
  ri."day_of_month",
  ri."next_run_date",
  false,
  ri."is_active",
  ri."last_generated_at",
  ri."created_by_clerk_user_id",
  ri."version",
  ri."created_at",
  ri."updated_at"
FROM "recurring_invoices" ri
WHERE NOT EXISTS (
  SELECT 1 FROM "recurring_entries" re
   WHERE re."tenant_id" = ri."tenant_id" AND re."id" = ri."id"
);
--> statement-breakpoint

-- Same id, so this is a copy rather than a join through a mapping.
UPDATE "invoices"
   SET "recurring_entry_id" = "recurring_invoice_id"
 WHERE "recurring_invoice_id" IS NOT NULL
   AND "recurring_entry_id" IS NULL;
