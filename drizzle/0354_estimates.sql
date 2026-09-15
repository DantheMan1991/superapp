-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333, 0335, 0337, 0339,
-- 0343, 0348 and 0352 are, and for the same reason: drizzle-kit emits every
-- ADD CONSTRAINT before every CREATE INDEX, which fails when two NEW tables in
-- one file reference each other. `job_estimate_lines_estimate_fk` points at
-- `job_estimates(tenant_id, id)`, and a composite FK needs a UNIQUE index on
-- exactly those columns to exist FIRST, so `job_estimates_tenant_id_id_idx` is
-- moved up ahead of the constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_estimate_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"cost_code_id" uuid,
	"description" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity_thousandths" bigint DEFAULT 1000 NOT NULL,
	"unit_cost_cents" bigint DEFAULT 0 NOT NULL,
	"markup_ppm" integer,
	"unit_price_cents" bigint,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_lines_description_present" CHECK (length(btrim("job_estimate_lines"."description")) > 0),
	CONSTRAINT "job_estimate_lines_quantity_nonnegative" CHECK ("job_estimate_lines"."quantity_thousandths" >= 0),
	CONSTRAINT "job_estimate_lines_unit_cost_nonnegative" CHECK ("job_estimate_lines"."unit_cost_cents" >= 0),
	CONSTRAINT "job_estimate_lines_unit_price_nonnegative" CHECK ("job_estimate_lines"."unit_price_cents" is null or "job_estimate_lines"."unit_price_cents" >= 0),
	CONSTRAINT "job_estimate_lines_markup_range" CHECK ("job_estimate_lines"."markup_ppm" is null or ("job_estimate_lines"."markup_ppm" >= 0 and "job_estimate_lines"."markup_ppm" <= 10000000))
);
--> statement-breakpoint
CREATE TABLE "job_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"number" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_on" date,
	"decided_on" date,
	"valid_until" date,
	"markup_ppm" integer DEFAULT 0 NOT NULL,
	"overhead_ppm" integer DEFAULT 0 NOT NULL,
	"profit_ppm" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimates_number_present" CHECK (length(btrim("job_estimates"."number")) > 0),
	CONSTRAINT "job_estimates_status_valid" CHECK ("job_estimates"."status" in ('draft', 'sent', 'accepted', 'declined', 'superseded')),
	CONSTRAINT "job_estimates_markup_range" CHECK ("job_estimates"."markup_ppm" >= 0 and "job_estimates"."markup_ppm" <= 10000000),
	CONSTRAINT "job_estimates_overhead_range" CHECK ("job_estimates"."overhead_ppm" >= 0 and "job_estimates"."overhead_ppm" <= 10000000),
	CONSTRAINT "job_estimates_profit_range" CHECK ("job_estimates"."profit_ppm" >= 0 and "job_estimates"."profit_ppm" <= 10000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimates_tenant_id_id_idx" ON "job_estimates" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."job_estimates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_lines_tenant_id_id_idx" ON "job_estimate_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_estimate_lines_tenant_estimate_idx" ON "job_estimate_lines" USING btree ("tenant_id","estimate_id","sort_order");--> statement-breakpoint
CREATE INDEX "job_estimate_lines_tenant_code_idx" ON "job_estimate_lines" USING btree ("tenant_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimates_project_number_idx" ON "job_estimates" USING btree ("tenant_id","project_id","number");--> statement-breakpoint
CREATE INDEX "job_estimates_tenant_project_idx" ON "job_estimates" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_estimates_tenant_contract_idx" ON "job_estimates" USING btree ("tenant_id","contract_id");