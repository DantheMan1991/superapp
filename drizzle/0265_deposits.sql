-- deposits (2026-09-07): customer payments held in Undeposited Funds, banked
-- together as ONE entry — the slip the teller stamps. One row per deposit,
-- born atomically with its entry (unique per entry, as a payment is); the
-- payments it banked point at it through invoice_payments.deposit_id, which
-- a void clears back to null. Composite tenant FKs to entities, bank_accounts
-- and journal_entries, so a row can never name another tenant's register or
-- entry. NO ACTION on the new payment FK: a deposit is voided, never deleted,
-- so no cascade is ever wanted. One company per deposit (the register's) is
-- enforced by `recordDeposit`, not here. RLS is 0266, beside this one.
-- docs/modules/accounting.md.

CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"deposit_date" date NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_total_positive" CHECK ("deposits"."total_cents" > 0),
	CONSTRAINT "deposits_status_known" CHECK ("deposits"."status" in ('posted', 'void'))
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "deposit_id" uuid;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tenant_id_id_idx" ON "deposits" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "deposits_tenant_bank_date_idx" ON "deposits" USING btree ("tenant_id","bank_account_id","deposit_date");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tenant_entry_idx" ON "deposits" USING btree ("tenant_id","journal_entry_id");--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_deposit_fk" FOREIGN KEY ("tenant_id","deposit_id") REFERENCES "public"."deposits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_deposit_idx" ON "invoice_payments" USING btree ("tenant_id","deposit_id");