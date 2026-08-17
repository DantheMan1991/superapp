-- entity_id becomes NOT NULL on invoices, bills and bank_accounts — the
-- CONTRACT half of ADR 0010 slice 1b, and it runs AFTER the deploy that writes
-- those columns.
--
-- WHY IT COULD NOT SHIP IN `0145`. Migrations go out ahead of the deploy, and
-- the deploy running while `0145` landed did not write these columns, so a NOT
-- NULL there would have rejected every invoice, bill and bank account created
-- in that window. `0145` added them nullable and backfilled; this closes them.
-- Third time this repo has made the split — `0123`/`0125` for the sales-tax
-- CHECK, `0142`/`0144` for `journal_entries.entity_id`, now these three.
--
-- `src/db/schema/*.ts` has declared all three NOT NULL since `0145`, one release
-- ahead of the database on purpose. From here the two agree, and those comments
-- come off with this.
--
-- THE BACKFILLS RUN AGAIN FIRST, and that is the point rather than caution.
-- Rows written between `0145` and the deploy going live have a NULL entity_id —
-- nothing was writing the column yet — and until they are repaired they are
-- invisible to every company-scoped report and list. Guarded, so a no-op when
-- there is nothing to fix.
--
-- Verified on the app database before this ran: 4 invoices, 2 bills, 3 bank
-- accounts, zero nulls on all three, and zero rows naming another tenant's
-- company. The composite FKs from `0145` are already in place, so nothing here
-- can be the first thing to notice a bad reference.
--
-- It was NOT clean on the dev branch, which is why the repair below exists —
-- see the comment on the INSERT.

-- FIRST, repair any tenant that has no company at all.
--
-- `0142` gave every tenant that existed then a default company, and
-- `provisionAccounting` gives one to every tenant created since — so this
-- should match nothing, and on the app database it does. It matched on the dev
-- branch, where a test fixture written before slice 1 created a tenant with
-- invoices and no company, and the bare `SET NOT NULL` failed with nothing but
-- `column "entity_id" contains null values` to go on.
--
-- This is a REPAIR rather than an invention: `0142` already established that
-- every tenant has exactly one company, so a tenant lacking one is a gap in
-- that invariant and this is the same guarded statement that closed it. It
-- keeps the migration correct on any database rather than only on the two we
-- happened to check.
INSERT INTO "entities" ("tenant_id", "name", "is_default")
SELECT t."id", t."name", true
  FROM "tenants" t
 WHERE NOT EXISTS (SELECT 1 FROM "entities" e WHERE e."tenant_id" = t."id");
--> statement-breakpoint

UPDATE "invoices" i
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = i."tenant_id" AND e."is_default" AND i."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "bills" b
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = b."tenant_id" AND e."is_default" AND b."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "bank_accounts" ba
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = ba."tenant_id" AND e."is_default" AND ba."entity_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "invoices" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "entity_id" SET NOT NULL;
