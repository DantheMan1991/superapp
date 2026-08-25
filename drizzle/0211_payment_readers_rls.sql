-- payment_readers: RLS. ENABLE + FORCE, and **members hold SELECT only**, the
-- same posture as `payment_accounts` (drizzle/0207) and for a related reason.
--
-- WHY NOT MEMBER-WRITABLE, when the label on the device is genuinely theirs.
-- Because this row is a MIRROR OF STRIPE, not a record of our own. A row here
-- that Stripe has never heard of is not a harmless stray: it is a device the
-- till will offer, at a stall, and pushing a payment to it fails with a
-- customer holding a card. Every write in `src/lib/payments/terminal.ts`
-- happens AFTER Stripe has already accepted the device, under `withSystem`, so
-- the row cannot exist without the registration existing.
--
-- Renaming goes the same way round — Stripe first, because the label is what
-- the device shows on its own screen, and the copy here is the copy.
--
-- STAFF CAN READ, and that is deliberate. The till is worked by whoever is
-- standing at the stall; a reader only the owner could see is a reader nobody
-- can take money on. Registering one is `owner` in the action layer, because
-- choosing which company's bank a device pays into is a decision rather than a
-- chore — the same split `retail` draws between setting a price and recording
-- what the pitch cost.
--
-- CROSS-TENANT LEAKAGE HERE IS NOT ABSTRACT. The row names the connected
-- account a device's takings land in, so another tenant's reader appearing in
-- this list would be a device pointed at somebody else's bank account. The
-- composite FK to `(tenant_id, payment_account_id)` makes that shape
-- unrepresentable even under `withSystem`; this is the layer above it.

ALTER TABLE "payment_readers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_readers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_readers_superadmin_all ON "payment_readers"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY payment_readers_member_read ON "payment_readers"
  FOR SELECT
  USING ("tenant_id" = app_current_tenant());
