-- The CONTRACT half of ADR 0010 slice 4, and it runs AFTER the deploy that
-- writes per-company locks. Two statements that could not ship in `0152`, for
-- the two opposite reasons this repo keeps relearning.
--
--   1. `period_closes.entity_id` SET NOT NULL. It could not be NOT NULL in
--      `0152` because migrations go out AHEAD of the deploy, and the build
--      running while that landed still inserted closes with no company — the
--      constraint would have rejected every close in that window. Same split as
--      `0123`/`0125`, `0142`/`0144`, `0145`/`0146`.
--   2. `accounting_settings.closed_through` DROP. The opposite rule: a DROP goes
--      out AFTER the deploy that stops SELECTing the column, because Drizzle
--      builds its select list from schema.ts and a running old build would 500
--      on every settings read. `src/db/schema/invoicing.ts` stopped declaring it
--      in the slice-4 PR, which is live (48aa06b). That is the `0147` lesson.
--
-- CHECKED ON BOTH DATABASES BEFORE WRITING THIS: zero `period_closes` rows have
-- a NULL entity_id, so the window produced nothing to repair. The guarded
-- backfill below runs anyway — it is the repair path for rows nobody would
-- otherwise fix, and a no-op is the expected result, not the assumption.

-- BACKFILL RE-RUN, for closes written between `0152` and the deploy.
-- Only touches NULLs, so a close the new build wrote is never rewritten.
UPDATE "period_closes" p
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = p."tenant_id"
   AND e."is_default"
   AND p."entity_id" IS NULL;--> statement-breakpoint

ALTER TABLE "period_closes" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint

-- `0152`'s BACKFILL 1 IS DELIBERATELY NOT RE-RUN, and this is the only
-- interesting decision in the file. It copied the tenant-wide scalar onto every
-- company; re-running it now would copy a STALE scalar over live per-company
-- locks. On production the scalar still reads 2026-06-30 while Oak Row LLC has
-- since closed through 2026-07-31 — a re-run would silently reopen a month
-- somebody closed. A backfill is only safe to repeat while it is still the
-- source of truth, and this one stopped being that the moment the deploy went
-- live.
ALTER TABLE "accounting_settings" DROP COLUMN "closed_through";
