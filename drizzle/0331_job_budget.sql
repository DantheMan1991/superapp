CREATE TABLE "job_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"original_cents" bigint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_budget_lines_original_nonnegative" CHECK ("job_budget_lines"."original_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_budget_lines" ADD CONSTRAINT "job_budget_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_budget_lines" ADD CONSTRAINT "job_budget_lines_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_budget_lines" ADD CONSTRAINT "job_budget_lines_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_budget_lines_tenant_id_id_idx" ON "job_budget_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_budget_lines_project_code_idx" ON "job_budget_lines" USING btree ("tenant_id","project_id","cost_code_id");--> statement-breakpoint
CREATE INDEX "job_budget_lines_tenant_project_idx" ON "job_budget_lines" USING btree ("tenant_id","project_id");