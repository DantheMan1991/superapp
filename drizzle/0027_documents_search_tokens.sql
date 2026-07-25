-- Fix filename and email tokenization in the search index.
--
-- 0026 replaced '-' and '_' in file_name, which was not enough. Postgres'
-- default parser recognises emails, hostnames and file paths as SINGLE tokens,
-- so:
--
--   'acmewidgets.pdf'      -> one "file"/"host" lexeme
--   'zephyrqx@example.com' -> one "email" lexeme
--
-- which means searching "acmewidgets" or "zephyrqx" matched nothing. The
-- failure mode is nasty because the index looks like it works: "invoice"
-- matches "2026-invoice_acmewidgets.pdf" fine, and it is only the distinctive
-- part of a name — the part anyone would actually type — that silently misses.
--
-- Splitting '.' and '@' as well turns those into ordinary word lexemes.
-- Applied only to file_name and email_from, the two machine-shaped fields.
-- title and description are human text, where over-splitting would hurt phrase
-- searches more than it helps.
--
-- A generated column's expression cannot be altered in place before PG 17, so
-- the column is dropped and re-added (which also drops the index — recreated
-- below). No data is lost: every value is derived. On a large table this would
-- rewrite the table; `documents` is small and this is a correctness fix.
--
-- Safe against the running code for the same reason 0026 was: a generated
-- column is never inserted into, and Drizzle builds explicit column lists.
DROP INDEX IF EXISTS "documents_search_idx";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint

ALTER TABLE "documents" ADD COLUMN "search_tsv" tsvector
GENERATED ALWAYS AS (
     setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A')
  || setweight(to_tsvector('english'::regconfig,
       translate(coalesce("file_name", ''), '-_.', '   ')), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce("doc_kind", '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce("description", '')), 'B')
  || setweight(to_tsvector('english'::regconfig,
       coalesce("extraction" -> 'fields' -> 'vendorName' ->> 'value', '')), 'B')
  || setweight(to_tsvector('english'::regconfig, coalesce("email_subject", '')), 'C')
  || setweight(to_tsvector('english'::regconfig,
       translate(coalesce("email_from", ''), '@.', '  ')), 'D')
  || setweight(to_tsvector('english'::regconfig,
       left(coalesce("extracted_text", ''), 200000)), 'D')
) STORED;
--> statement-breakpoint

CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search_tsv");
