CREATE TABLE "job_estimate_line_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"markup_id" uuid NOT NULL,
	"figure" text NOT NULL,
	"share_thousandths" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_line_traces_figure_valid" CHECK ("job_estimate_line_traces"."figure" in ('length', 'area', 'count', 'perimeter', 'wall', 'roof', 'volume')),
	CONSTRAINT "job_estimate_line_traces_share_nonneg" CHECK ("job_estimate_line_traces"."share_thousandths" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD COLUMN "figures" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_line_traces" ADD CONSTRAINT "job_estimate_line_traces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_line_traces" ADD CONSTRAINT "job_estimate_line_traces_line_fk" FOREIGN KEY ("tenant_id","line_id") REFERENCES "public"."job_estimate_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_line_traces" ADD CONSTRAINT "job_estimate_line_traces_markup_fk" FOREIGN KEY ("tenant_id","markup_id") REFERENCES "public"."job_sheet_markups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_line_traces_tenant_id_id_idx" ON "job_estimate_line_traces" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_line_traces_once_idx" ON "job_estimate_line_traces" USING btree ("tenant_id","line_id","markup_id","figure");--> statement-breakpoint
CREATE INDEX "job_estimate_line_traces_tenant_markup_idx" ON "job_estimate_line_traces" USING btree ("tenant_id","markup_id");--> statement-breakpoint
CREATE INDEX "job_estimate_line_traces_tenant_line_idx" ON "job_estimate_line_traces" USING btree ("tenant_id","line_id");--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_figures_object" CHECK (jsonb_typeof("job_sheet_markups"."figures") = 'object');