-- ADR 0010 slice 4: the period lock becomes PER COMPANY.
--
-- HAND-EDITED THREE WAYS, and the header says so because each one is a rule
-- this repo has learned the hard way:
--
--   1. drizzle-kit emitted `ALTER TABLE accounting_settings DROP COLUMN
--      closed_through` at the end of this file. IT HAS BEEN REMOVED. A DROP
--      goes out AFTER the deploy that stops selecting the column, never before:
--      Drizzle builds its SELECT list from schema.ts, so dropping it under a
--      running old build 500s every settings read. That is the 0147 lesson, and
--      the contract migration after this deploy is where it belongs.
--   2. It emitted no backfill at all. Both are added below, and they are the
--      whole point — without them every existing lock silently disappears and
--      entries could be posted into closed months.
--   3. It emitted the foreign key before the backfill. Reordered so the FK
--      validates real values rather than a column of nulls.
--
-- `entity_id` arrives NULLABLE and stays that way for one release. Migrations
-- run AHEAD of the deploy, and the build running while this lands still inserts
-- closes without an entity — a NOT NULL here would make every close in that
-- window fail. The contract migration re-runs the backfill and then closes it.

ALTER TABLE "entities" ADD COLUMN "closed_through" date;--> statement-breakpoint
ALTER TABLE "period_closes" ADD COLUMN "entity_id" uuid;--> statement-breakpoint

-- BACKFILL 1: every company inherits the tenant-wide lock it was already under.
-- This is what makes the change invisible to anybody already closed — the books
-- stay locked through exactly the date they were locked through this morning.
UPDATE "entities" e
   SET "closed_through" = s."closed_through"
  FROM "accounting_settings" s
 WHERE s."tenant_id" = e."tenant_id"
   AND s."closed_through" IS NOT NULL;--> statement-breakpoint

-- BACKFILL 2: existing close ROWS belong to the tenant's default company.
--
-- An honest approximation, and the only one available: a close written before
-- today locked EVERY company at once, so no single company is the true owner.
-- The default is the company that holds every entry posted before slice 1, so
-- it is the closest thing to a truthful answer — and the LOCK itself is
-- preserved for every company by backfill 1 above, which is the part that
-- matters. Production has exactly one such row (a two-company tenant, closed
-- through 2026-06-30, checked before writing this).
--
-- The consequence, stated rather than discovered later: a non-default company
-- carrying an inherited lock has no close row to reopen. It can only be closed
-- forward. That is recorded in docs/modules/accounting.md.
UPDATE "period_closes" p
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = p."tenant_id"
   AND e."is_default"
   AND p."entity_id" IS NULL;--> statement-breakpoint

ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- One LIVE close per period end PER COMPANY. Two companies closing the same
-- June is the ordinary case now, not a collision — which is exactly what the
-- old index would have refused.
--
-- ONE HONEST GAP IN THE WINDOW between this migration and the deploy: the old
-- build writes closes with a NULL entity_id, and Postgres treats NULLs as
-- distinct in a unique index, so during that window the "one completed close
-- per period" guarantee is not enforced. Reaching it needs somebody to close
-- the SAME period twice in those minutes, and the close screen only offers
-- period ends after the current closed-through, so there is no path to it from
-- the UI. Stated rather than discovered.
DROP INDEX "period_closes_tenant_period_completed_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_tenant_entity_period_completed_idx" ON "period_closes" USING btree ("tenant_id","entity_id","period_end") WHERE "period_closes"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "period_closes_tenant_entity_idx" ON "period_closes" USING btree ("tenant_id","entity_id");
