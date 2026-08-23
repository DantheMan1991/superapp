-- Two contract jobs that have been owed since 2026-08-12 and 2026-08-13, and
-- they belong together because both must run AFTER this PR's deploy.
--
--  1. DROP `recurring_invoices` and `invoices.recurring_invoice_id`. The fold
--     into `recurring_entries` (`0121`/`0122`) stopped reading them that day;
--     the DROP waited because Drizzle builds its SELECT column list from
--     `schema.ts`, so a deployment still declaring the column selects it, and
--     dropping under a live old build 500s every invoice page. That is the
--     `0075`/`0088` lesson and it INVERTS the usual order: schema first, deploy,
--     then this.
--
--  2. ADD the CHECK `total_cents = subtotal_cents + tax_cents`. It could not
--     ship with `0123` for the opposite reason — migrations precede deploys,
--     and the deployment running then wrote `total_cents` without touching
--     `subtotal_cents`, so the constraint would have rejected every draft edit
--     in that window. Every write path has written all three together since.
--
-- The CHECK is safe before OR after a deploy; the DROP is only safe after. So
-- both go here, and this file runs after — one instruction rather than two
-- with opposite rules.
--
-- VERIFIED BEFORE WRITING THIS. App database: zero invoices where
-- `total <> subtotal + tax`, zero rows in `recurring_invoices`, zero invoices
-- with a `recurring_invoice_id`. The dev branch had two violating invoices,
-- both belonging to a `Merge Test` tenant left behind by an interrupted test
-- run; the fixtures that made them now state the arithmetic, and the stale rows
-- were removed by hand rather than papered over by this migration. An invoice
-- whose total does not equal subtotal plus tax is a real problem when the data
-- is real, and a migration that silently rewrote one to satisfy a constraint
-- would be the worst possible way to find that out.
--
-- CASCADE on the table drop is drizzle-kit's, and it is doing nothing here:
-- the only dependency was `invoices_recurring_fk`, dropped explicitly below.

ALTER TABLE "recurring_invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "recurring_invoices" CASCADE;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_recurring_fk";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "recurring_invoice_id";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_is_subtotal_plus_tax" CHECK ("invoices"."total_cents" = "invoices"."subtotal_cents" + "invoices"."tax_cents");
