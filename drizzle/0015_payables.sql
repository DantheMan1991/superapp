CREATE TYPE "public"."bill_status" AS ENUM('draft', 'awaiting_approval', 'approved', 'partial', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_from_account_id" uuid NOT NULL,
	"method" text DEFAULT 'other' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_payments_amount_positive" CHECK ("bill_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"bill_number" text DEFAULT '' NOT NULL,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date,
	"memo" text DEFAULT '' NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"journal_entry_id" uuid,
	"ai_coding" jsonb,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_total_nonnegative" CHECK ("bills"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"default_expense_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_one_target";--> statement-breakpoint
ALTER TABLE "line_dimensions" DROP CONSTRAINT "line_dimensions_one_parent";--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "ai_last_bill_coded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_links" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD COLUMN "bill_line_id" uuid;--> statement-breakpoint
-- Moved up (hand edit): composite parent keys must exist before the
-- same-migration FKs that reference them (0013 precedent).
CREATE UNIQUE INDEX "vendors_tenant_id_id_idx" ON "vendors" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_tenant_id_id_idx" ON "bills" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_lines_tenant_id_id_idx" ON "bill_lines" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bills"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_paid_from_fk" FOREIGN KEY ("tenant_id","paid_from_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_default_account_fk" FOREIGN KEY ("tenant_id","default_expense_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_lines_bill_line_no_idx" ON "bill_lines" USING btree ("tenant_id","bill_id","line_no");--> statement-breakpoint
CREATE INDEX "bill_lines_tenant_bill_idx" ON "bill_lines" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payments_tenant_id_id_idx" ON "bill_payments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "bill_payments_tenant_bill_idx" ON "bill_payments" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payments_tenant_entry_idx" ON "bill_payments" USING btree ("tenant_id","journal_entry_id");--> statement-breakpoint
CREATE INDEX "bills_tenant_status_idx" ON "bills" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "bills_tenant_vendor_idx" ON "bills" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_tenant_entry_idx" ON "bills" USING btree ("tenant_id","journal_entry_id") WHERE "bills"."journal_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "bills_tenant_vendor_number_idx" ON "bills" USING btree ("tenant_id","vendor_id","bill_number") WHERE "bills"."bill_number" <> '';--> statement-breakpoint
CREATE INDEX "vendors_tenant_idx" ON "vendors" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_bill_line_fk" FOREIGN KEY ("tenant_id","bill_line_id") REFERENCES "public"."bill_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_doc_bill_idx" ON "document_links" USING btree ("tenant_id","document_id","bill_id") WHERE "document_links"."bill_id" is not null;--> statement-breakpoint
CREATE INDEX "document_links_tenant_bill_idx" ON "document_links" USING btree ("tenant_id","bill_id") WHERE "document_links"."bill_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "line_dimensions_bill_line_type_idx" ON "line_dimensions" USING btree ("tenant_id","bill_line_id","dimension_type") WHERE "line_dimensions"."bill_line_id" is not null;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_one_target" CHECK (num_nonnulls("document_links"."journal_entry_id", "document_links"."bank_transaction_id", "document_links"."invoice_id", "document_links"."bill_id") = 1);--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_one_parent" CHECK (num_nonnulls("line_dimensions"."journal_line_id", "line_dimensions"."invoice_line_id", "line_dimensions"."bill_line_id") = 1);