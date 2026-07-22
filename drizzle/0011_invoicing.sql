CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'partial', 'paid', 'void');
--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('monthly');
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"income_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("invoice_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"deposit_account_id" uuid NOT NULL,
	"method" text DEFAULT 'other' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount_positive" CHECK ("invoice_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"memo" text DEFAULT '' NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"journal_entry_id" uuid,
	"recurring_invoice_id" uuid,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_total_nonnegative" CHECK ("invoices"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" jsonb NOT NULL,
	"frequency" "recurring_frequency" DEFAULT 'monthly' NOT NULL,
	"day_of_month" integer NOT NULL,
	"next_run_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_generated_at" timestamp with time zone,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_invoices_day_of_month" CHECK ("recurring_invoices"."day_of_month" between 1 and 28)
);
--> statement-breakpoint
ALTER TABLE "line_dimensions" ALTER COLUMN "journal_line_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD COLUMN "invoice_line_id" uuid;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_id_id_idx" ON "customers" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_tenant_id_id_idx" ON "invoice_lines" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_invoice_line_no_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id","line_no");
--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_tenant_id_id_idx" ON "invoice_payments" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_invoice_idx" ON "invoice_payments" USING btree ("tenant_id","invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_tenant_entry_idx" ON "invoice_payments" USING btree ("tenant_id","journal_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_id_id_idx" ON "invoices" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_idx" ON "invoices" USING btree ("tenant_id","invoice_number");
--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_entry_idx" ON "invoices" USING btree ("tenant_id","journal_entry_id") WHERE "invoices"."journal_entry_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_invoices_tenant_id_id_idx" ON "recurring_invoices" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "recurring_invoices_tenant_next_idx" ON "recurring_invoices" USING btree ("tenant_id","next_run_date") WHERE "recurring_invoices"."is_active" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "line_dimensions_invoice_line_type_idx" ON "line_dimensions" USING btree ("tenant_id","invoice_line_id","dimension_type") WHERE "line_dimensions"."invoice_line_id" is not null;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_one_parent" CHECK (num_nonnulls("line_dimensions"."journal_line_id", "line_dimensions"."invoice_line_id") = 1);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_income_account_fk" FOREIGN KEY ("tenant_id","income_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_deposit_account_fk" FOREIGN KEY ("tenant_id","deposit_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_fk" FOREIGN KEY ("tenant_id","recurring_invoice_id") REFERENCES "public"."recurring_invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_invoice_line_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
