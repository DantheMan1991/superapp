CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');
--> statement-breakpoint
CREATE TYPE "public"."entry_edit_policy" AS ENUM('standard', 'strict_append_only');
--> statement-breakpoint
CREATE TYPE "public"."journal_entry_source" AS ENUM('manual', 'invoice', 'invoice_payment', 'bill', 'bill_payment', 'bank_import', 'opening_balance', 'recurring', 'reversal');
--> statement-breakpoint
CREATE TYPE "public"."journal_entry_status" AS ENUM('draft', 'posted', 'void');
--> statement-breakpoint
CREATE TABLE "accounting_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"closed_through" date,
	"coa_template" text DEFAULT 'general' NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"entry_edit_policy" "entry_edit_policy" DEFAULT 'standard' NOT NULL,
	"bookkeeping_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"subtype" text DEFAULT 'other' NOT NULL,
	"parent_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dimension_type" text NOT NULL,
	"pack_entity_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"status" "journal_entry_status" DEFAULT 'draft' NOT NULL,
	"source" "journal_entry_source" DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"idempotency_key" text,
	"reverses_entry_id" uuid,
	"posted_at" timestamp with time zone,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_amount_nonzero" CHECK ("journal_lines"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "line_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL,
	"dimension_type" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dimension_members" ADD CONSTRAINT "dimension_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_settings_tenant_idx" ON "accounting_settings" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_id_id_idx" ON "accounts" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_code_idx" ON "accounts" USING btree ("tenant_id","code");
--> statement-breakpoint
CREATE INDEX "accounts_tenant_idx" ON "accounts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "accounts_tenant_type_idx" ON "accounts" USING btree ("tenant_id","account_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_members_tenant_id_id_idx" ON "dimension_members" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_members_tenant_type_entity_idx" ON "dimension_members" USING btree ("tenant_id","dimension_type","pack_entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_members_tenant_type_id_idx" ON "dimension_members" USING btree ("tenant_id","dimension_type","id");
--> statement-breakpoint
CREATE INDEX "dimension_members_tenant_idx" ON "dimension_members" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_id_id_idx" ON "journal_entries" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");
--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_status_idx" ON "journal_entries" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_idem_idx" ON "journal_entries" USING btree ("tenant_id","idempotency_key") WHERE "journal_entries"."idempotency_key" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_reverses_idx" ON "journal_entries" USING btree ("tenant_id","reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_tenant_id_id_idx" ON "journal_lines" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_line_no_idx" ON "journal_lines" USING btree ("tenant_id","entry_id","line_no");
--> statement-breakpoint
CREATE INDEX "journal_lines_tenant_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");
--> statement-breakpoint
CREATE INDEX "journal_lines_tenant_entry_idx" ON "journal_lines" USING btree ("tenant_id","entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "line_dimensions_line_type_idx" ON "line_dimensions" USING btree ("tenant_id","journal_line_id","dimension_type");
--> statement-breakpoint
CREATE INDEX "line_dimensions_tenant_member_idx" ON "line_dimensions" USING btree ("tenant_id","member_id");
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("tenant_id","reverses_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_line_fk" FOREIGN KEY ("tenant_id","journal_line_id") REFERENCES "public"."journal_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "line_dimensions" ADD CONSTRAINT "line_dimensions_member_fk" FOREIGN KEY ("tenant_id","dimension_type","member_id") REFERENCES "public"."dimension_members"("tenant_id","dimension_type","id") ON DELETE no action ON UPDATE no action;
