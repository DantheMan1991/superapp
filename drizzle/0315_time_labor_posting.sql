-- Time slice 6: hours reach the books.
--
-- Two statements, and they may share a migration even though the first adds an
-- enum value. The rule `depreciation` and `intercompany` were split out for is
-- that a value cannot be USED in the transaction that adds it -- Drizzle runs
-- every pending migration in one -- and nothing here uses it. `payroll_accrual`
-- is only ever written at runtime, by a request that arrives long after this
-- transaction has committed.
--
-- `posts_labor` is FALSE for every existing tenant, which is the point: a
-- business keeping hours for scheduling must not find journal entries it never
-- asked for the morning after a deploy.

ALTER TYPE "public"."journal_entry_source" ADD VALUE 'payroll_accrual';--> statement-breakpoint
ALTER TABLE "time_settings" ADD COLUMN "posts_labor" boolean DEFAULT false NOT NULL;
