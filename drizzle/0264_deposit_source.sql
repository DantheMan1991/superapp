-- ALONE IN ITS OWN MIGRATION, for the reason 0127 gives: `ALTER TYPE ... ADD
-- VALUE` cannot be used in the transaction that adds it, so the value goes in
-- here and nothing in this file or the next writes a row with it — only
-- runtime code does.
--
-- `deposit` names the entry a bank deposit posts (Dr the register / Cr
-- Undeposited Funds); `source_id` is the `deposits` row (0265). It is in
-- MANAGED_SOURCES (core/guards.ts): the journal refuses to void it, because
-- the payments it banked point at the deposit and would stay marked as banked.
-- docs/modules/accounting.md, 2026-09-07.

ALTER TYPE "public"."journal_entry_source" ADD VALUE IF NOT EXISTS 'deposit' BEFORE 'depreciation';
