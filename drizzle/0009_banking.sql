CREATE TYPE "public"."bank_account_kind" AS ENUM('checking', 'savings', 'credit_card');
--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_source" AS ENUM('csv', 'plaid');
--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_status" AS ENUM('unreviewed', 'posted', 'excluded');
--> statement-breakpoint
CREATE TYPE "public"."plaid_item_status" AS ENUM('active', 'error');
--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('in_progress', 'completed');
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "bank_account_kind" NOT NULL,
	"institution" text DEFAULT '' NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"plaid_item_id" text,
	"plaid_account_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_last4_digits" CHECK ("bank_accounts"."last4" ~ '^[0-9]{0,4}$')
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"external_hash" text NOT NULL,
	"source" "bank_transaction_source" DEFAULT 'csv' NOT NULL,
	"status" "bank_transaction_status" DEFAULT 'unreviewed' NOT NULL,
	"journal_entry_id" uuid,
	"ai_suggestion" jsonb,
	"raw" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plaid_item_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"institution_name" text DEFAULT '' NOT NULL,
	"sync_cursor" text,
	"status" "plaid_item_status" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"statement_end_date" date NOT NULL,
	"statement_end_balance_cents" bigint NOT NULL,
	"status" "reconciliation_status" DEFAULT 'in_progress' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "ai_last_suggested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_tenant_id_id_idx" ON "bank_accounts" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_tenant_account_idx" ON "bank_accounts" USING btree ("tenant_id","account_id");
--> statement-breakpoint
CREATE INDEX "bank_accounts_tenant_idx" ON "bank_accounts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_tenant_id_id_idx" ON "bank_transactions" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_dedup_idx" ON "bank_transactions" USING btree ("tenant_id","bank_account_id","external_hash");
--> statement-breakpoint
CREATE INDEX "bank_transactions_tenant_acct_status_idx" ON "bank_transactions" USING btree ("tenant_id","bank_account_id","status");
--> statement-breakpoint
CREATE INDEX "bank_transactions_tenant_acct_date_idx" ON "bank_transactions" USING btree ("tenant_id","bank_account_id","txn_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_tenant_entry_idx" ON "bank_transactions" USING btree ("tenant_id","journal_entry_id") WHERE "bank_transactions"."journal_entry_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_items_tenant_id_id_idx" ON "plaid_items" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_items_tenant_item_idx" ON "plaid_items" USING btree ("tenant_id","plaid_item_id");
--> statement-breakpoint
CREATE INDEX "plaid_items_tenant_idx" ON "plaid_items" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_lines_tenant_line_idx" ON "reconciliation_lines" USING btree ("tenant_id","journal_line_id");
--> statement-breakpoint
CREATE INDEX "reconciliation_lines_tenant_recon_idx" ON "reconciliation_lines" USING btree ("tenant_id","reconciliation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_tenant_id_id_idx" ON "reconciliations" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_one_active_idx" ON "reconciliations" USING btree ("tenant_id","bank_account_id") WHERE "reconciliations"."status" = 'in_progress';
--> statement-breakpoint
CREATE INDEX "reconciliations_tenant_acct_idx" ON "reconciliations" USING btree ("tenant_id","bank_account_id");
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_recon_fk" FOREIGN KEY ("tenant_id","reconciliation_id") REFERENCES "public"."reconciliations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_line_fk" FOREIGN KEY ("tenant_id","journal_line_id") REFERENCES "public"."journal_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
