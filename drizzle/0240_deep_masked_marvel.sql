-- recurring_entries.generated_through: the last period the sweep generated,
-- and the sweep is its only writer. Additive; runs ahead of the deploy.
--
-- Backfilled from next_run_date - 1 month for every row that has generated:
-- advanceMonthly steps exactly one calendar month and day_of_month is 1-28,
-- so that subtraction is exact wherever only the sweep had moved the date,
-- which was every row until editing shipped minutes before this.
--
-- THE WINDOW BETWEEN THIS RUNNING ON PRODUCTION AND THE DEPLOY IS NOT NEUTRAL.
-- The code still running in it is the previous sweep, which advances
-- next_run_date and does not write generated_through, so a row generated in
-- the window is left with a frontier one month LOW — and the new guard would
-- then accept an edit back into the month just generated. The cron acts only
-- at 6am in each tenant's zone; the residual path is somebody pressing
-- Generate now in the minutes between the migration and the deploy. Apply this
-- immediately before merging, and afterwards run:
--   select id, name from recurring_entries
--    where last_generated_at is not null
--      and (generated_through is null
--           or generated_through <> (next_run_date - interval '1 month')::date);
-- The NULL arm is a row whose FIRST-ever generation landed in the window: it
-- had no last_generated_at at backfill time, so the backfill skipped it, and
-- the guard treats NULL as free. A row listed was either forward-edited since
-- (expected, safe — the audit row ledger.recurring_updated says so) or
-- generated in the window (unsafe: set generated_through to
-- next_run_date - 1 month by hand).

ALTER TABLE "recurring_entries" ADD COLUMN "generated_through" date;
--> statement-breakpoint
UPDATE "recurring_entries"
   SET "generated_through" = ("next_run_date" - interval '1 month')::date
 WHERE "last_generated_at" IS NOT NULL
   AND "generated_through" IS NULL;
