-- Notifications prerequisite 2: carry the one timezone the system already had
-- up to the tenant, so every module shares it.
--
-- accounting_settings.bookkeeping_timezone (0007) was the only timezone in the
-- platform. It was read in 21 places across the accounting module and written
-- in NONE — there has never been a UI or an action that set it, so every row
-- holds the 'America/New_York' default. The backfill below is therefore a
-- no-op on today's data by construction, and it is still the right thing to
-- write: the moment a tenant HAD set a bookkeeping timezone, silently
-- relocating their books to a different day boundary would be a financial bug,
-- and this statement is what makes that impossible for anyone who migrates
-- later from a database where the column was populated.
--
-- COALESCE guards the tenants that have no accounting_settings row at all
-- (accounting is a paid module most tenants have not enabled) — they keep the
-- column default rather than becoming NULL.

UPDATE "tenants" t
   SET "timezone" = COALESCE(a."bookkeeping_timezone", t."timezone")
  FROM "accounting_settings" a
 WHERE a."tenant_id" = t."id"
   AND a."bookkeeping_timezone" IS NOT NULL
   AND a."bookkeeping_timezone" <> t."timezone";
--> statement-breakpoint

-- accounting_settings.bookkeeping_timezone is NOT dropped here on purpose.
-- The previous deployment is still serving while this runs, and its accounting
-- pages SELECT that column; dropping it now would 500 every one of them. It is
-- unread as of this release and a follow-up migration removes it once this
-- code is live. Expand now, contract later.
