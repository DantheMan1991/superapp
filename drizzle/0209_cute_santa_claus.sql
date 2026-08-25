-- payment_accounts: add Accounts v2's vocabulary. Paired with 0208.
--
--   card_payments_status         `configuration.merchant.capabilities
--                                 .card_payments.status` — active | pending |
--                                 restricted | unsupported. NULLABLE, and null
--                                 means "Stripe has not said", which is not the
--                                 same as restricted.
--   status_details               [{code, resolution}] — Stripe saying whether
--                                 the fix is provide_info, contact_stripe or
--                                 nothing at all.
--   requirements                 a trimmed projection of `requirements.entries`,
--                                 each carrying who it is awaiting action from
--                                 and which capabilities it restricts. FIELD
--                                 NAMES, never field values: no tax id, bank
--                                 detail or document lands here.
--   requirements_deadline_status currently_due | eventually_due | past_due.
--                                 Separate from the timestamp because a real
--                                 account returns `past_due` with a NULL time,
--                                 so urgency cannot be inferred from the date.
--   display_name                 replaces business_name; v2's field.
--   closed_at                    replaces deauthorized_at; v2 says `closed`.

ALTER TABLE "payment_accounts" ADD COLUMN "card_payments_status" text;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "status_details" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "requirements_deadline_status" text;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "closed_at" timestamp with time zone;