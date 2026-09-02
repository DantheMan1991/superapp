-- recurring_entries.generated_through: the last period the sweep generated,
-- and the sweep is its only writer. Additive; runs ahead of the deploy.
--
-- Backfilled from next_run_date - 1 month for every row that has generated:
-- advanceMonthly steps exactly one calendar month and day_of_month is 1-28,
-- so that subtraction is exact wherever only the sweep had moved the date,
-- which was every row until editing shipped hours before this.

ALTER TABLE "recurring_entries" ADD COLUMN "generated_through" date;
--> statement-breakpoint
UPDATE "recurring_entries"
   SET "generated_through" = ("next_run_date" - interval '1 month')::date
 WHERE "last_generated_at" IS NOT NULL
   AND "generated_through" IS NULL;
