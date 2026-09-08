-- credit_memos (2026-09-07): a credit against one invoice — a returned item,
-- a price adjustment, a goodwill credit. One row per memo, born atomically
-- with its entry (unique per entry, as an invoice is). THE DECISION THAT KEEPS
-- IT SMALL: the memo settles the invoice the way a payment does, through an
-- invoice_payments row of method credit_memo (payment_id, unique while set),
-- so every reader of an invoice's balance sees the credit without learning a
-- new word. Composite tenant FKs to the company, the customer, the invoice,
-- the settlement row, the income account and the entry. NO ACTION on the
-- payment FK: the void detaches the memo before deleting the row. RLS is
-- 0270, beside this one. docs/modules/accounting.md.

CREATE TABLE "credit_memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"income_account_id" uuid NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_memos_total_positive" CHECK ("credit_memos"."total_cents" > 0),
	CONSTRAINT "credit_memos_status_known" CHECK ("credit_memos"."status" in ('issued', 'void'))
);
--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."invoice_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_income_account_fk" FOREIGN KEY ("tenant_id","income_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_memos_tenant_id_id_idx" ON "credit_memos" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_memos_tenant_number_idx" ON "credit_memos" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "credit_memos_tenant_invoice_idx" ON "credit_memos" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_memos_tenant_customer_idx" ON "credit_memos" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_memos_tenant_entry_idx" ON "credit_memos" USING btree ("tenant_id","journal_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_memos_tenant_payment_idx" ON "credit_memos" USING btree ("tenant_id","payment_id") WHERE "credit_memos"."payment_id" is not null;