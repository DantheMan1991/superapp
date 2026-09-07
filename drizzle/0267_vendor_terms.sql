-- vendors.payment_terms_id (2026-09-07): a vendor's usual payment terms —
-- the same payment_terms rows customers use, because a term is a term. Null
-- means NO terms (the due date is typed), not the tenant default: that
-- default is a sales default, the one new invoices start on. A composite
-- tenant FK, so a vendor can never name another tenant's term; certified in
-- tests/isolation/payables.test.ts. The bill form, the Inbox's Create bill
-- and the email-thread drafter all read it. docs/modules/accounting.md.

ALTER TABLE "vendors" ADD COLUMN "payment_terms_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_payment_terms_fk" FOREIGN KEY ("tenant_id","payment_terms_id") REFERENCES "public"."payment_terms"("tenant_id","id") ON DELETE no action ON UPDATE no action;