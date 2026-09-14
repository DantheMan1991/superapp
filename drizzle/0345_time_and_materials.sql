CREATE TABLE "job_pay_application_labor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pay_application_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"minutes_to_date" integer DEFAULT 0 NOT NULL,
	"previous_minutes" integer DEFAULT 0 NOT NULL,
	"previous_cents" bigint DEFAULT 0 NOT NULL,
	"this_period_minutes" integer DEFAULT 0 NOT NULL,
	"this_period_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_pay_application_labor_rate_nonnegative" CHECK ("job_pay_application_labor"."rate_cents" >= 0),
	CONSTRAINT "job_pay_application_labor_to_date_nonnegative" CHECK ("job_pay_application_labor"."minutes_to_date" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_wip_lines" DROP CONSTRAINT "job_wip_lines_reason_valid";--> statement-breakpoint
ALTER TABLE "job_wip_lines" DROP CONSTRAINT "job_wip_lines_method_valid";--> statement-breakpoint
ALTER TABLE "job_contracts" ADD COLUMN "labor_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "job_pay_applications" ADD COLUMN "labor_to_date_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_pay_application_labor" ADD CONSTRAINT "job_pay_application_labor_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_labor" ADD CONSTRAINT "job_pay_application_labor_app_fk" FOREIGN KEY ("tenant_id","pay_application_id") REFERENCES "public"."job_pay_applications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pay_application_labor" ADD CONSTRAINT "job_pay_application_labor_worker_fk" FOREIGN KEY ("tenant_id","worker_id") REFERENCES "public"."time_workers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_labor_tenant_id_id_idx" ON "job_pay_application_labor" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_pay_application_labor_app_worker_rate_idx" ON "job_pay_application_labor" USING btree ("tenant_id","pay_application_id","worker_id","rate_cents");--> statement-breakpoint
CREATE INDEX "job_pay_application_labor_tenant_app_idx" ON "job_pay_application_labor" USING btree ("tenant_id","pay_application_id");--> statement-breakpoint
ALTER TABLE "job_contracts" ADD CONSTRAINT "job_contracts_labor_rate_nonnegative" CHECK ("job_contracts"."labor_rate_cents" is null or "job_contracts"."labor_rate_cents" >= 0);--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_reason_valid" CHECK ("job_wip_lines"."reason" in ('', 'no_value', 'no_estimate', 'no_rate'));--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_method_valid" CHECK ("job_wip_lines"."method" in ('cost_to_cost', 'cost_plus', 'time_and_materials'));