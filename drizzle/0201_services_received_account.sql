-- `2060 Services Received Not Invoiced` for every tenant that already has books.
--
-- **THE ACCOUNT THE PROCESSING ACCRUAL CREDITS.** A run's outputs credit the
-- CONSUMPTION account for the whole pot they were costed from, and the plant's
-- share of that pot was never debited there by anything — so `completeRun` posts
-- `Dr consumption / Cr 2060` to supply the missing debit. Without the account,
-- completing a run with a fee on it refuses.
--
-- NOT `2050`. A processing fee genuinely is money owed for something received
-- and not yet invoiced, so Goods Received Not Invoiced reads right — and
-- `unbilledReceipts` builds the GRNI working from stock RECEIPTS, which an
-- accrued service has none of. A balance in 2050 that its own reconciliation
-- could never explain is precisely the defect `owesASupplier` was extracted to
-- stop.
--
-- ADDED TO THE TEMPLATE TOO, so every tenant provisioned after this gets it from
-- `provisionAccounting` (which is idempotent and additive). This statement is
-- the backfill for the tenants that already exist — the same arrangement
-- `drizzle/0142` used to give every existing tenant a default company.
--
-- Guarded THREE ways: only tenants that have a chart at all, never twice on the
-- code, and never twice on the subtype. A tenant who has already built their own
-- accrual account under this subtype keeps theirs, because `resolveServicesAccruedAccount`
-- refuses ambiguity rather than picking one, and minting a second would break the
-- posting for the one tenant who was ahead of us.

INSERT INTO "accounts" ("tenant_id", "code", "name", "account_type", "subtype", "is_system")
SELECT DISTINCT a."tenant_id", '2060', 'Services Received Not Invoiced', 'liability'::"account_type", 'services_received', true
FROM "accounts" a
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" b
  WHERE b."tenant_id" = a."tenant_id"
    AND (b."code" = '2060' OR b."subtype" = 'services_received')
);
