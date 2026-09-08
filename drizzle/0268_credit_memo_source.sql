-- ALONE IN ITS OWN MIGRATION, for the reason 0127 gives: `ALTER TYPE ... ADD
-- VALUE` cannot be used in the transaction that adds it, so the value goes in
-- here and nothing in this file or the next writes a row with it — only
-- runtime code does.
--
-- `credit_memo` names the entry a credit memo posts (Dr the income it comes
-- off / Cr Accounts Receivable); `source_id` is the `credit_memos` row (0269).
-- It is in MANAGED_SOURCES (core/guards.ts): voided from the memo, which also
-- removes the payment row that settles the invoice — the journal alone would
-- leave that row. docs/modules/accounting.md, 2026-09-07.

ALTER TYPE "public"."journal_entry_source" ADD VALUE IF NOT EXISTS 'credit_memo' BEFORE 'depreciation';
