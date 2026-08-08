-- Make search reach INSIDE files: the producer's columns.
--
-- `documents.extracted_text` has existed since 0023 and has been indexed by
-- `search_tsv` at weight D since 0026. Nothing ever wrote it except the mail
-- seam, so until now search matched a document's METADATA and never its
-- contents — a filing cabinet rather than a searchable one.
--
-- Nothing here creates a table, so there is deliberately NO --custom RLS
-- migration alongside this one. RLS is row-level: `documents` and
-- `document_versions` already carry FORCE'd policies, and a new COLUMN on an
-- existing table is covered by them the moment it exists. Adding a policy here
-- would be a second place for the visibility rule to be wrong. Verified after
-- migrating with `npx tsx scripts/verify-rls.ts`, because "migrations complete"
-- is not evidence.
--
-- SAFE AGAINST THE RUNNING CODE, which matters because this repo migrates the
-- live database ahead of the deploy (the rule 0025 was written in blood for).
-- Every column is added NOT NULL WITH A DEFAULT, so rows written by the
-- currently-deployed code — which has never heard of `text_extraction` — get
-- 'pending' and satisfy the CHECK. Drizzle builds explicit column lists from
-- schema.ts, so no existing SELECT picks the new columns up either. This
-- migration only expands; nothing here may be run after the deploy instead.
--
-- 'pending' as the default is doing real work: it makes every pre-existing
-- document the backfill's queue, with no separate marking pass.
--   npm run docs:extract-text
--
-- WHY THE TEXT ALSO LIVES ON THE VERSION ROW. `document_versions` is the log of
-- every set of bytes a document has ever had, and it already stores every other
-- descriptor of those bytes: file_name, mime_type, size_bytes, sha256. Text is
-- one more descriptor of the bytes, so it follows the same rule — authoritative
-- on the version, denormalized onto the document by promoteVersion. The payoff
-- is that restoring v1 restores v1's text with no blob read and no re-parse,
-- and that "the index describes the CURRENT bytes" is one assignment in one
-- function rather than an invariant two call sites must remember.
--
-- The state vocabulary is `text` + CHECK rather than a pgEnum, following this
-- module's standing rule: ALTER TYPE ... ADD VALUE cannot be used in the
-- transaction that adds it and Drizzle wraps each file in one, so a seventh
-- state would need a migration file of its own containing a single statement.
ALTER TABLE "document_versions" ADD COLUMN "extracted_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "text_extraction" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_extraction" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- PARTIAL, and NOT unique. Partial because a plain btree over six states would
-- be useless, whereas this one holds only the rows still needing work and
-- shrinks to almost nothing once the backfill has run — which is the steady
-- state. Not unique because no other unique index may ever be added to
-- `documents`: createDocumentRecord uses a bare .onConflictDoNothing(), which
-- covers EVERY unique constraint on the table, so a second one would silently
-- turn legitimate inserts into swallowed conflicts.
CREATE INDEX "documents_text_extraction_pending_idx" ON "documents" USING btree ("tenant_id","created_at") WHERE "documents"."text_extraction" in ('pending', 'failed');--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_text_extraction_check" CHECK ("document_versions"."text_extraction" in ('pending', 'done', 'empty', 'unsupported', 'too_large', 'failed'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_text_extraction_check" CHECK ("documents"."text_extraction" in ('pending', 'done', 'empty', 'unsupported', 'too_large', 'failed'));