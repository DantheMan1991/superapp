-- HAND-REORDERED, the same way drizzle/0325, 0329 and 0333 are, and for the
-- same reason: drizzle-kit emits every ADD CONSTRAINT before every CREATE
-- INDEX, which fails when new tables in one file reference each other.
--
-- `job_pay_application_lines_app_fk` points at `job_pay_applications(tenant_id,
-- id)` and `job_pay_application_lines_sov_fk` at `job_sov_lines(tenant_id, id)`,
-- and a composite FK needs a UNIQUE index on exactly those columns to exist
-- FIRST. So both `*_tenant_id_id_idx` indexes are moved up here, ahead of the
-- constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_pay_application_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pay_application_id" uuid NOT NULL,
	"sov_line_id" uuid NOT NULL,
	"scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"previous_cents" bigint DEFAULT 0 NOT NULL,
	"this_period_cents" bigint DEFAULT 0 NOT NULL,
	"stored_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_pay_application_lines_previous_nonnegative" CHECK ("job_pay_application_lines"."previous_cents" >= 0),
	CONSTRAINT "job_pay_application_lines_stored_nonnegative" CHECK ("job_pay_application_lines"."stored_cents" >= 0),
	CONSTRAINT "job_pay_application_lines_completed_nonnegative" CHECK ("job_pay_application_lines"."previous_cents" + "job_pay_application_lines"."this_period_cents" + "job_pay_application_lines"."stored_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_pay_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_to" date NOT NULL,
	"retainage_ppm" integer DEFAULT 0 NOT NULL,
	"scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"completed_to_date_cents" bigint DEFAULT 0 NOT NULL,
	"retainage_cents" bigint DEFAULT 0 NOT NULL,
	"previous_certificates_cents" bigint DEFAULT 0 NOT NULL,
	"due_cents" bigint DEFAULT 0 NOT NULL,
	"invoice_id" uuid,
	"issued_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_pay_applications_status_valid" CHECK ("job_pay_applications"."status" in ('draft', 'issued', 'void')),
	CONSTRAINT "job_pay_applications_retainage_range" CHECK ("job_pay_applications"."retainage_ppm" >= 0 and "job_pay_applications"."retainage_ppm" <= 1000000),
	CONSTRAINT "job_pay_applications_number_positive" CHECK ("job_pay_applications"."number" > 0),
	CONSTRAINT "job_pay_applications_issued_has_invoice" CHECK (("job_pay_applications"."status" = 'draft') = ("job_pay_applications"."invoice_id" is null))
);
--> statement-breakpoint
CREATE TABLE "job_sov_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"scheduled_cents" bigint NOT NULL,
	"cost_code_id" uuid,
	"change_order_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sov_lines_description_present" CHECK (length(btrim("job_sov_lines"."description")) > 0),
	CONSTRAINT "job_sov_lines_scheduled_nonnegative" CHECK ("job_sov_lines"."scheduled_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_applications_tenant_id_id_idx" ON "job_pay_applications" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sov_lines_tenant_id_id_idx" ON "job_sov_lines" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ADD CONSTRAINT "job_pay_application_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ADD CONSTRAINT "job_pay_application_lines_app_fk" FOREIGN KEY ("tenant_id","pay_application_id") REFERENCES "public"."job_pay_applications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ADD CONSTRAINT "job_pay_application_lines_sov_fk" FOREIGN KEY ("tenant_id","sov_line_id") REFERENCES "public"."job_sov_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD CONSTRAINT "job_pay_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD CONSTRAINT "job_pay_applications_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD CONSTRAINT "job_pay_applications_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_change_order_fk" FOREIGN KEY ("tenant_id","change_order_id") REFERENCES "public"."job_change_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_lines_tenant_id_id_idx" ON "job_pay_application_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_lines_app_sov_idx" ON "job_pay_application_lines" USING btree ("tenant_id","pay_application_id","sov_line_id");--> statement-breakpoint
CREATE INDEX "job_pay_application_lines_tenant_app_idx" ON "job_pay_application_lines" USING btree ("tenant_id","pay_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_applications_contract_number_idx" ON "job_pay_applications" USING btree ("tenant_id","contract_id","number");--> statement-breakpoint
CREATE INDEX "job_pay_applications_tenant_contract_idx" ON "job_pay_applications" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "job_sov_lines_tenant_contract_idx" ON "job_sov_lines" USING btree ("tenant_id","contract_id","sort_order");