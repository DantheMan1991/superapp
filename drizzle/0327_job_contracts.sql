CREATE TABLE "job_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"counterparty_party_id" uuid,
	"role" text DEFAULT 'prime' NOT NULL,
	"billing_method" text DEFAULT 'fixed_price' NOT NULL,
	"value_cents" bigint,
	"status" text DEFAULT 'proposed' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"signed_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_contracts_kind_format" CHECK ("job_contracts"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "job_contracts_role_valid" CHECK ("job_contracts"."role" in ('prime', 'subcontract')),
	CONSTRAINT "job_contracts_status_valid" CHECK ("job_contracts"."status" in ('proposed', 'signed', 'complete', 'declined', 'cancelled')),
	CONSTRAINT "job_contracts_billing_method_valid" CHECK ("job_contracts"."billing_method" in ('fixed_price', 'progress_draw', 'schedule_of_values', 'draw_schedule', 'cost_plus_fee', 'unit_price', 'time_and_materials')),
	CONSTRAINT "job_contracts_value_nonnegative" CHECK ("job_contracts"."value_cents" is null or "job_contracts"."value_cents" >= 0),
	CONSTRAINT "job_contracts_sequence_nonnegative" CHECK ("job_contracts"."sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_counterparty_fk" FOREIGN KEY ("tenant_id","counterparty_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_contracts_tenant_id_id_idx" ON "job_contracts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_contracts_tenant_project_idx" ON "job_contracts" USING btree ("tenant_id","project_id","sequence");--> statement-breakpoint
CREATE INDEX "job_contracts_tenant_status_idx" ON "job_contracts" USING btree ("tenant_id","status");