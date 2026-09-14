CREATE TABLE "job_pay_application_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pay_application_id" uuid NOT NULL,
	"cost_code_id" uuid,
	"ledger_to_date_cents" bigint DEFAULT 0 NOT NULL,
	"previous_cents" bigint DEFAULT 0 NOT NULL,
	"this_period_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_contracts" ADD COLUMN "fee_ppm" integer;--> statement-breakpoint
ALTER TABLE "job_contracts" ADD COLUMN "fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "job_contracts" ADD COLUMN "gmax_cents" bigint;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD COLUMN "cost_to_date_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD COLUMN "fee_to_date_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD COLUMN "method" text DEFAULT 'cost_to_cost' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_pay_application_costs" ADD CONSTRAINT "job_pay_application_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_costs" ADD CONSTRAINT "job_pay_application_costs_app_fk" FOREIGN KEY ("tenant_id","pay_application_id") REFERENCES "public"."job_pay_applications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_costs" ADD CONSTRAINT "job_pay_application_costs_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_costs_tenant_id_id_idx" ON "job_pay_application_costs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_costs_app_code_idx" ON "job_pay_application_costs" USING btree ("tenant_id","pay_application_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "job_pay_application_costs_tenant_app_idx" ON "job_pay_application_costs" USING btree ("tenant_id","pay_application_id");--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_fee_ppm_range" CHECK ("job_contracts"."fee_ppm" is null or ("job_contracts"."fee_ppm" >= 0 and "job_contracts"."fee_ppm" <= 1000000));--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_fee_nonnegative" CHECK ("job_contracts"."fee_cents" is null or "job_contracts"."fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_gmax_nonnegative" CHECK ("job_contracts"."gmax_cents" is null or "job_contracts"."gmax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_method_valid" CHECK ("job_wip_lines"."method" in ('cost_to_cost', 'cost_plus'));