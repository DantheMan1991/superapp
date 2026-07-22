CREATE TYPE "public"."document_source" AS ENUM('upload', 'email');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('inbox', 'filed', 'trashed');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"bank_transaction_id" uuid,
	"invoice_id" uuid,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_links_one_target" CHECK (num_nonnulls("document_links"."journal_entry_id", "document_links"."bank_transaction_id", "document_links"."invoice_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blob_pathname" text,
	"file_name" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"source" "document_source" DEFAULT 'upload' NOT NULL,
	"status" "document_status" DEFAULT 'inbox' NOT NULL,
	"email_from" text DEFAULT '' NOT NULL,
	"email_subject" text DEFAULT '' NOT NULL,
	"email_message_id" text DEFAULT '' NOT NULL,
	"email_received_at" timestamp with time zone,
	"uploaded_by_clerk_user_id" text,
	"extraction_status" "extraction_status" DEFAULT 'pending' NOT NULL,
	"extraction" jsonb,
	"trashed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_size_nonnegative" CHECK ("documents"."size_bytes" >= 0)
);
--> statement-breakpoint
-- Moved up (hand edit): the composite parent key must exist before
-- document_links_document_fk references it in this same migration.
CREATE UNIQUE INDEX "documents_tenant_id_id_idx" ON "documents" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "inbound_email_token" text;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "ai_last_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_bank_txn_fk" FOREIGN KEY ("tenant_id","bank_transaction_id") REFERENCES "public"."bank_transactions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_tenant_id_id_idx" ON "document_links" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "document_links_tenant_document_idx" ON "document_links" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_doc_entry_idx" ON "document_links" USING btree ("tenant_id","document_id","journal_entry_id") WHERE "document_links"."journal_entry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_doc_bank_txn_idx" ON "document_links" USING btree ("tenant_id","document_id","bank_transaction_id") WHERE "document_links"."bank_transaction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_doc_invoice_idx" ON "document_links" USING btree ("tenant_id","document_id","invoice_id") WHERE "document_links"."invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "document_links_tenant_entry_idx" ON "document_links" USING btree ("tenant_id","journal_entry_id") WHERE "document_links"."journal_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "document_links_tenant_bank_txn_idx" ON "document_links" USING btree ("tenant_id","bank_transaction_id") WHERE "document_links"."bank_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "document_links_tenant_invoice_idx" ON "document_links" USING btree ("tenant_id","invoice_id") WHERE "document_links"."invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_blob_pathname_idx" ON "documents" USING btree ("blob_pathname") WHERE "documents"."blob_pathname" is not null;--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_sha256_idx" ON "documents" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_tenant_extraction_idx" ON "documents" USING btree ("tenant_id","extraction_status");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_settings_inbound_token_idx" ON "accounting_settings" USING btree ("inbound_email_token") WHERE "accounting_settings"."inbound_email_token" is not null;