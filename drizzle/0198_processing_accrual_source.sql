-- `journal_entry_source` gains `production_processing_accrual`.
--
-- ALONE IN ITS OWN MIGRATION, which is what `depreciation` (0139) and
-- `intercompany` (0150) both did and for the reason recorded beside them: an
-- enum value cannot be USED in the transaction that adds it, and drizzle runs
-- every pending migration in one. Nothing in this batch uses it — the value is
-- written by application code at run time — but keeping the arrangement means
-- the next person adding a value does not have to work out whether theirs is
-- the case that breaks.
--
-- DELIBERATELY NOT IN `MACHINE_SOURCES`. See the comment beside the value in
-- `src/db/schema/ledger.ts`: `completeRun` is owner-only, so `requireOwnerRole`
-- is exactly the check this entry should meet, and ADR 0011's privilege
-- boundary must not widen to admit an act that does not need it.

ALTER TYPE "public"."journal_entry_source" ADD VALUE 'production_processing_accrual';
