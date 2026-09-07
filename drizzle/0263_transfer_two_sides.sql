-- Transfers between the tenant's own registers (docs/modules/accounting.md,
-- 2026-09-06). A transfer is ONE entry — Dr the account the money reached, Cr
-- the one it left — and the feed shows it on both registers, so both rows
-- point at that entry. The partial unique index that backs P12 ("a feed row is
-- satisfied by exactly one entry") was (tenant_id, journal_entry_id): one row
-- per entry, full stop, which forced one side of every transfer to be
-- excluded and hand-journaled. It is now per REGISTER: two rows on the same
-- register pointing at one entry is still the double count it refuses.
--
-- Safe under the deploy that precedes it: the old code never links two rows
-- to one entry, so relaxing the index changes nothing it does.

DROP INDEX "bank_transactions_tenant_entry_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_tenant_acct_entry_idx" ON "bank_transactions" USING btree ("tenant_id","bank_account_id","journal_entry_id") WHERE "bank_transactions"."journal_entry_id" is not null;