-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333, 0335, 0337 and 0339
-- are, and for the same reason: drizzle-kit emits every ADD CONSTRAINT before
-- every CREATE INDEX, which fails when two NEW tables in one file reference
-- each other. `job_sub_application_lines_app_fk` points at
-- `job_sub_applications(tenant_id, id)`, and a composite FK needs a UNIQUE
-- index on exactly those columns to exist FIRST, so
-- `job_sub_applications_tenant_id_id_idx` is moved up ahead of the
-- constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_sub_application_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sub_application_id" uuid NOT NULL,
	"commitment_line_id" uuid NOT NULL,
	"scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"previous_cents" bigint DEFAULT 0 NOT NULL,
	"this_period_cents" bigint DEFAULT 0 NOT NULL,
	"stored_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sub_application_lines_previous_nonnegative" CHECK ("job_sub_application_lines"."previous_cents" >= 0),
	CONSTRAINT "job_sub_application_lines_stored_nonnegative" CHECK ("job_sub_application_lines"."stored_cents" >= 0),
	CONSTRAINT "job_sub_application_lines_completed_nonnegative" CHECK ("job_sub_application_lines"."previous_cents" + "job_sub_application_lines"."this_period_cents" + "job_sub_application_lines"."stored_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_sub_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_to" date NOT NULL,
	"retainage_ppm" integer DEFAULT 0 NOT NULL,
	"scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"completed_to_date_cents" bigint DEFAULT 0 NOT NULL,
	"retainage_cents" bigint DEFAULT 0 NOT NULL,
	"previous_certificates_cents" bigint DEFAULT 0 NOT NULL,
	"due_cents" bigint DEFAULT 0 NOT NULL,
	"bill_id" uuid,
	"billed_on" date,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sub_applications_status_valid" CHECK ("job_sub_applications"."status" in ('draft', 'billed', 'void')),
	CONSTRAINT "job_sub_applications_retainage_range" CHECK ("job_sub_applications"."retainage_ppm" >= 0 and "job_sub_applications"."retainage_ppm" <= 1000000),
	CONSTRAINT "job_sub_applications_number_positive" CHECK ("job_sub_applications"."number" > 0),
	CONSTRAINT "job_sub_applications_billed_has_bill" CHECK (("job_sub_applications"."status" = 'draft') = ("job_sub_applications"."bill_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_sub_applications_tenant_id_id_idx" ON "job_sub_applications" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ADD CONSTRAINT "job_sub_application_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ADD CONSTRAINT "job_sub_application_lines_app_fk" FOREIGN KEY ("tenant_id","sub_application_id") REFERENCES "public"."job_sub_applications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ADD CONSTRAINT "job_sub_application_lines_commitment_line_fk" FOREIGN KEY ("tenant_id","commitment_line_id") REFERENCES "public"."job_commitment_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sub_applications" ADD CONSTRAINT "job_sub_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sub_applications" ADD CONSTRAINT "job_sub_applications_commitment_fk" FOREIGN KEY ("tenant_id","commitment_id") REFERENCES "public"."job_commitments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sub_applications" ADD CONSTRAINT "job_sub_applications_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sub_application_lines_tenant_id_id_idx" ON "job_sub_application_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sub_application_lines_app_line_idx" ON "job_sub_application_lines" USING btree ("tenant_id","sub_application_id","commitment_line_id");--> statement-breakpoint
CREATE INDEX "job_sub_application_lines_tenant_app_idx" ON "job_sub_application_lines" USING btree ("tenant_id","sub_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sub_applications_commitment_number_idx" ON "job_sub_applications" USING btree ("tenant_id","commitment_id","number");--> statement-breakpoint
CREATE INDEX "job_sub_applications_tenant_commitment_idx" ON "job_sub_applications" USING btree ("tenant_id","commitment_id");