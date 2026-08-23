-- The Due from / Due to Affiliates accounts, for tenants that already have a
-- chart (ADR 0010 slice 2).
--
-- `provisionAccounting` adds them from the template, but it only runs when the
-- accounting module is switched on — so every tenant already using accounting
-- would get `AFFILIATE_ACCOUNTS_MISSING` instead of a feature. Same repair
-- shape as `0142`'s one-company-per-tenant insert, and guarded the same way.
--
-- SKIPPED WHERE THE CODE IS ALREADY TAKEN, which matches what
-- `provisionAccounting` itself does with a template account whose code a tenant
-- has since used for something else. Such a tenant gets the accounts by adding
-- them by hand with the right subtype; inventing a different code here would
-- put an account nobody chose into somebody's chart of accounts, and the chart
-- is the one thing in this module a client reads top to bottom.
--
-- Guarded on BOTH the subtype and the code, so a re-run is a no-op and a tenant
-- that already has one of the pair only gains the other.
--
-- Only tenants with an `accounting_settings` row: that is what "uses
-- accounting" means, and a tenant without one has no chart to add to.

INSERT INTO "accounts" ("tenant_id", "code", "name", "account_type", "subtype", "is_system", "description")
SELECT s."tenant_id", '1500', 'Due from Affiliates', 'asset', 'due_from_affiliate', true,
       'Owed to this company by another company of the same client'
  FROM "accounting_settings" s
 WHERE NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."subtype" = 'due_from_affiliate')
   AND NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."code" = '1500');
--> statement-breakpoint

INSERT INTO "accounts" ("tenant_id", "code", "name", "account_type", "subtype", "is_system", "description")
SELECT s."tenant_id", '2450', 'Due to Affiliates', 'liability', 'due_to_affiliate', true,
       'Owed by this company to another company of the same client'
  FROM "accounting_settings" s
 WHERE NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."subtype" = 'due_to_affiliate')
   AND NOT EXISTS (
         SELECT 1 FROM "accounts" a
          WHERE a."tenant_id" = s."tenant_id" AND a."code" = '2450');
