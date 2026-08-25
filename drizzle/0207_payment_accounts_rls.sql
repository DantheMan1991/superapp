-- payment_accounts: RLS. ENABLE + FORCE, per drizzle/0173_retail_rls.sql —
-- but with ONE deliberate difference from every other tenant table in this
-- schema, and it is the point of the file.
--
-- MEMBERS HOLD SELECT ONLY. There is no member INSERT, UPDATE or DELETE policy,
-- so a `withTenant` transaction cannot write this table at all.
--
-- WHY. Every column here except the tenant and the company is STRIPE'S VERDICT:
-- `charges_enabled`, `payouts_enabled`, `details_submitted`, and the list of
-- what Stripe is still waiting for. Those are the outcome of a KYC review this
-- platform does not perform and cannot second-guess. S7 already says billing
-- state is written only from trusted Stripe data — the signature-verified
-- webhook or a server→Stripe reconcile — and everywhere else in this codebase
-- that rule is kept by care at the call site. Here it is kept by the database.
--
-- The failure it forecloses is specific. A forgotten `withTenant` scope, an
-- over-eager future action, or a pack reaching for a column it should not touch
-- could otherwise flip `charges_enabled` to true, and the till would believe
-- it: the farm would be told it can take a card, and the customer's card would
-- be declined at a stall with a queue behind it. The app asserting what only
-- Stripe may assert is the whole class of bug, and a missing policy is a
-- cheaper guard than a convention.
--
-- WHAT THIS COSTS, so the next person does not "fix" it. `provisionAccounting`
-- runs inside a tenant transaction, so it cannot adopt an account created
-- before the books existed. Adoption is therefore lazy, under `withSystem`,
-- in src/lib/payments/connect.ts. See ADR 0015.
--
-- CROSS-TENANT LEAKAGE HERE IS NOT MERELY A DISCLOSURE. The row names the
-- Stripe account another business's money is paid into, and the requirements
-- list says exactly which identity documents that business has not yet given
-- Stripe. Nothing in it is a credential — the account id is an identifier and
-- the authority comes from the platform key — but it is a map of somebody
-- else's payment setup, and it belongs to them.

ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_accounts_superadmin_all ON "payment_accounts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY payment_accounts_member_read ON "payment_accounts"
  FOR SELECT
  USING ("tenant_id" = app_current_tenant());
