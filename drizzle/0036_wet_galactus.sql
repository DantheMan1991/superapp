-- ALONE IN THIS FILE, DELIBERATELY. A new enum value cannot be USED in the
-- same transaction that adds it, and the migration runner wraps a file in one.
-- Anything that references 'generated' therefore has to land in a later file —
-- see 0037. Splitting this out was a design call recorded in the build plan
-- before any of it was written; do not merge it into a neighbouring migration.
--
-- Safe against the running code: widening an enum breaks no existing reader,
-- and nothing writes 'generated' until the deploy that follows.
ALTER TYPE "public"."document_source" ADD VALUE IF NOT EXISTS 'generated';
