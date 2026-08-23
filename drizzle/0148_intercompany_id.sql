-- intercompany_id on journal_entries — the link between the two halves of an
-- intercompany transaction (ADR 0010 slice 2).
--
-- NULLABLE and staying that way, unlike `entity_id`: nearly every entry is an
-- ordinary single-company one and has no pair. There is no contract half owed
-- for this column.
--
-- Additive and safe under the running deploy, which simply never writes it.
-- The deferred constraint trigger that enforces "exactly two entries per id"
-- is `0149`, because triggers are never generated.

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "intercompany_id" uuid;--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_intercompany_idx" ON "journal_entries" USING btree ("tenant_id","intercompany_id") WHERE "journal_entries"."intercompany_id" is not null;
