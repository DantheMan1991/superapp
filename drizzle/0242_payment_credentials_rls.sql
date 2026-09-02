-- payment_credentials: RLS. ENABLE + FORCE — and NO MEMBER POLICY AT ALL, which
-- is the point of the file and the strictest posture in this schema.
--
-- WHAT IS IN HERE. A Square OAuth access token and refresh token for one
-- `payment_accounts` row, AES-256-GCM ciphertext via src/lib/crypto.ts (S8).
-- That token can charge and refund the farm's customers on the farm's Square
-- account, within the scopes the farm consented to.
--
-- WHY NOT EVEN A SELECT POLICY. `payment_accounts` gives members SELECT because
-- the till has to read "can this company take a card". `mail_accounts` gives
-- members SELECT on rows holding a mailbox token, and accepts the ciphertext
-- exposure because the key never leaves the environment. Here the cheaper and
-- stricter answer is available: nothing in a tenant transaction ever needs this
-- row. The one function that decrypts it (`accessTokenFor` in
-- src/lib/payments/square/accounts.ts) runs under withSystem, and the OAuth
-- callback that writes it has already proved the tenant, the owner and that the
-- token opens the account. So a tenant transaction — the owner's included —
-- SELECTs zero rows here, and INSERT is refused outright. tests/isolation
-- asserts both.
--
-- THE DENIAL IS SILENT FOR UPDATE AND DELETE, as on payment_accounts (drizzle
-- 0207): with no member policy there is no USING clause to satisfy, so Postgres
-- reports zero rows rather than raising. Only the INSERT is loud.
--
-- WHY THIS TABLE EXISTS AT ALL, when ADR 0015 refused to store a Stripe secret
-- key: a Square OAuth token is scoped, expires in thirty days unless renewed,
-- and the seller can revoke it from Square, which tells us. Square offers no
-- platform-key alternative. ADR 0017 weighs it.
--
-- CROSS-TENANT LEAKAGE HERE WOULD BE A CREDENTIAL, NOT A DISCLOSURE — which is
-- exactly why the composite FK (tenant_id, payment_account_id) makes filing a
-- token against another tenant's account unrepresentable even under withSystem,
-- and why this file gives members nothing to leak through.

ALTER TABLE "payment_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_credentials_superadmin_all ON "payment_credentials"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
