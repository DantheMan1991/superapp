-- The profile's display default, for tenants that already installed it.
--
-- `installProfile` copies `display.currencySymbol` onto the tenant, but it runs
-- at INSTALL — and the farms that want this most already installed months ago.
-- Without this they would have to re-install a profile to change a symbol,
-- which is a strange thing to ask and a worse thing to explain.
--
-- Backfill only. `is null` means it never overwrites a tenant who has already
-- chosen, and no other industry is touched: this is the one profile that
-- declares a symbol.

UPDATE "tenants"
   SET "currency_symbol" = '$'
 WHERE "industry" = 'homestead-farm'
   AND "currency_symbol" IS NULL;
