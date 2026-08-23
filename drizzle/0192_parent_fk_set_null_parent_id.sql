-- Nesting: make ON DELETE SET NULL mean what it says.
--
-- `schedule_items_parent_fk` and `work_items_parent_fk` are COMPOSITE self-FKs
-- on `(tenant_id, parent_id)` declared `ON DELETE SET NULL`. Postgres's bare
-- SET NULL nulls EVERY referencing column, `tenant_id` included — and
-- `tenant_id` is NOT NULL on both tables. So the declared behaviour cannot
-- happen: deleting a parent that still has a child does not unparent the child,
-- it fails outright with
--
--   null value in column "tenant_id" of relation "schedule_items"
--   violates not-null constraint
--
-- Reproduced on the dev branch inside a rolled-back transaction before this was
-- written, on both `schedule_items` and (identically shaped) `work_items`.
--
-- POSTGRES 15 ADDED THE COLUMN LIST — `ON DELETE SET NULL (parent_id)` — which
-- nulls only the column named and leaves `tenant_id` alone. Both databases run
-- 18.6. That is the whole fix, and it is the smallest one: the intent recorded
-- in `src/db/schema/scheduling.ts` and `work.ts` was always "the child survives
-- and becomes top-level", and this makes the constraint able to do it instead of
-- changing what nesting means.
--
-- WHY NOT CASCADE, which `production_bookings_run_fk` chose for the same trap on
-- the same day: a booking is meaningless without its run, but a sub-item is not
-- meaningless without its parent — and nothing forces a child to sit on the same
-- calendar or list as its parent. The only route that can fire this action today
-- is a cascade from above (delete a calendar, delete a list, delete a tenant),
-- so CASCADE would reach sideways and silently delete a live item out of a list
-- nobody touched. SET NULL cannot destroy a row; that asymmetry decided it.
--
-- WHY NOT RESTRICT, which the four other composite self-FKs in this schema use
-- (`assets`, `document_folders`, `inventory_lots`, `accounts`): those are
-- containers, where "re-parent what is inside it first" is the honest order of
-- operations. A checklist item is not a container. Their comments also say SET
-- NULL "is not available" on a composite FK — that was true before PG 15 and is
-- corrected in this PR; their RESTRICT stands on its own reasoning and is
-- unchanged here.
--
-- HAND-WRITTEN, AND IT HAS TO STAY THAT WAY. `.onDelete()` in Drizzle takes an
-- action, not a column list, so the TS declaration says plain `set null` and is
-- a lossy description of the constraint below. That is deliberate and it is the
-- quiet option: the drizzle-kit snapshot already records `"onDelete": "set
-- null"`, so schema and snapshot agree and `db:generate` sees no diff and never
-- tries to revert this. `drizzle-kit pull` would; nothing in this repo runs it.
-- Both schema files carry a comment pointing here. Same arrangement as the
-- `text_pattern_ops` path index hand-written in `drizzle/0024`.
--
-- SAFE AHEAD OF THE DEPLOY: no column changes, no rows change, and the running
-- code cannot tell the difference — every delete that failed before still has no
-- caller. Neither module deletes an item or its container (scheduling cancels,
-- work archives), which is why this has never been a user-facing 500.

ALTER TABLE "schedule_items" DROP CONSTRAINT "schedule_items_parent_fk";--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_id")
  REFERENCES "schedule_items"("tenant_id", "id")
  ON DELETE SET NULL ("parent_id");--> statement-breakpoint
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_parent_fk";--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_id")
  REFERENCES "work_items"("tenant_id", "id")
  ON DELETE SET NULL ("parent_id");
