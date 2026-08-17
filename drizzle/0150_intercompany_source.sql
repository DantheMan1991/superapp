-- The `intercompany` entry source (ADR 0010 slice 2).
--
-- ALONE IN ITS OWN MIGRATION, exactly as `depreciation` was in `0127`, and for
-- the reason `0121` had to recreate an enum rather than extend one: Postgres
-- refuses a value that is USED in the transaction that added it
-- (`check_safe_enum_use`), and Drizzle runs every pending migration inside ONE
-- transaction. Nothing here writes an entry, so `ADD VALUE` on its own is safe
-- — but no later migration in the same batch may insert one either, which is
-- why this is the last statement of the slice rather than the first.

ALTER TYPE "public"."journal_entry_source" ADD VALUE IF NOT EXISTS 'intercompany';
