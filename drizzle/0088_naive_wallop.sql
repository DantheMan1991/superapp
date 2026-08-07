-- Contract half of the timezone move (0086/0087): drop the deprecated
-- accounting column now that `tenants.timezone` is the business day.
--
-- ⚠ APPLY THIS **AFTER** THE DEPLOY, not before. It is the second migration in
-- the repo to invert the standing order — `0075` was the first, for the same
-- reason. Nothing READS this column's value any more, but Drizzle expands
-- `tx.query.accountingSettings.findFirst()` into an explicit column list built
-- from schema.ts, so any deployment whose schema still declares the column
-- SELECTs it. Dropping while that code is serving 500s `getSettings`, and with
-- it every accounting page. The schema.ts change and this migration must land
-- together, and this must run once the new build is live.
--
-- A last carry-up before the drop, deliberately NARROW:
--
--   only where the tenant is still sitting on the untouched default AND the
--   accounting column says something else.
--
-- NOT an unconditional re-run of 0087's backfill. Since 0086 shipped, an owner
-- can set a timezone at /dashboard/settings; copying accounting → tenant
-- blindly would silently overwrite a deliberate choice with a value from a
-- column that was never editable. The condition below can only ever move a
-- tenant that has never expressed one, which is the only case where this
-- column could still hold information the tenant does not.
--
-- On the database this was written against the statement matches zero rows:
-- the column had no UI and no writer in src/ for its entire life, so every row
-- holds the 0007 default. It is here for any database where that was not true.

UPDATE "tenants" t
   SET "timezone" = a."bookkeeping_timezone"
  FROM "accounting_settings" a
 WHERE a."tenant_id" = t."id"
   AND t."timezone" = 'America/New_York'
   AND a."bookkeeping_timezone" IS NOT NULL
   AND a."bookkeeping_timezone" <> 'America/New_York';
--> statement-breakpoint

ALTER TABLE "accounting_settings" DROP COLUMN "bookkeeping_timezone";
