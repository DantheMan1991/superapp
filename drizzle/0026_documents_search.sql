-- Full-text search over documents.
--
-- Safe against the running code (this repo migrates the live database ahead of
-- the deploy — see 0025). A generated column cannot be inserted into, so no
-- existing INSERT changes shape, and Drizzle always builds explicit column
-- lists from schema.ts, so no existing SELECT picks the column up either.
--
-- A GENERATED ... STORED column rather than a trigger or a side table: it is
-- in sync by construction, which is this codebase's standing preference for
-- invariants (the alternative is a second table that can silently drift, plus
-- its own RLS policy). `documents` is not write-hot — rows change on attach,
-- detach, trash and move — so paying the regeneration cost per UPDATE is fine.
--
-- Deliberately NOT modelled in src/db/schema.ts: Drizzle has no tsvector type,
-- and drizzle-kit diffs its own snapshots rather than introspecting the live
-- database, so a column it cannot see is safe from a spurious DROP. Queried
-- with raw sql`` from src/modules/documents/search.ts.
--
-- Three traps are baked into the expression below; all three fail late and
-- confusingly if you skip them.
--
--  1. `'english'::regconfig` is MANDATORY. The two-argument to_tsvector(text,
--     text) is STABLE, not IMMUTABLE, and a generated column requires an
--     immutable expression — without the cast this ALTER fails outright with
--     "generation expression is not immutable".
--
--  2. `left(extracted_text, 200000)`. A tsvector has a hard 1MB limit. An
--     unbounded OCR dump would make INSERTs start failing later, in
--     production, on a table that was fine yesterday.
--
--  3. `replace(-,_ -> space)` on file_name, or "2026-invoice_acme.pdf"
--     tokenizes as one useless lexeme and filename search quietly never works.
--
-- Tags are absent on purpose. array_to_string is STABLE, so it cannot appear
-- in a generated column at all, and a tag is a facet rather than a keyword —
-- it gets the separate GIN index on documents.tags and an explicit
-- `tags && $1` predicate.
ALTER TABLE "documents" ADD COLUMN "search_tsv" tsvector
GENERATED ALWAYS AS (
     setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A')
  || setweight(to_tsvector('english'::regconfig,
       replace(replace(coalesce("file_name", ''), '-', ' '), '_', ' ')), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce("doc_kind", '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce("description", '')), 'B')
  || setweight(to_tsvector('english'::regconfig,
       coalesce("extraction" -> 'fields' -> 'vendorName' ->> 'value', '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce("email_subject", '')), 'C')
  || setweight(to_tsvector('english'::regconfig, coalesce("email_from", '')), 'D')
  || setweight(to_tsvector('english'::regconfig,
       left(coalesce("extracted_text", ''), 200000)), 'D')
) STORED;
--> statement-breakpoint

CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search_tsv");
