-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333, 0335 and 0337 are, and
-- for the same reason: drizzle-kit emits every ADD CONSTRAINT before every
-- CREATE INDEX, which fails when two NEW tables in one file reference each
-- other. `job_wip_lines_period_fk` points at `job_wip_periods(tenant_id, id)`,
-- and a composite FK needs a UNIQUE index on exactly those columns to exist
-- FIRST, so `job_wip_periods_tenant_id_id_idx` is moved up ahead of the
-- constraints. Everything else is as generated.
--
-- THE ENUM VALUE COMES FIRST AND NOTHING HERE USES IT. `wip_adjustment` is
-- written only at runtime by the jobs pack (ADR 0059); a value cannot be used
-- in the transaction that adds it, and Drizzle runs every pending migration in
-- one, which is why 0127 and 0150 stood alone. This file is safe for the
-- reason 0315 was.
--
-- Regenerating this file will undo the move.

ALTER TYPE "public"."journal_entry_source" ADD VALUE 'wip_adjustment';--> statement-breakpoint
CREATE TABLE "job_wip_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"estimate_cents" bigint,
	"notes" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"contract_cents" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_cents" bigint DEFAULT 0 NOT NULL,
	"cost_to_date_cents" bigint DEFAULT 0 NOT NULL,
	"billed_cents" bigint DEFAULT 0 NOT NULL,
	"percent_complete_ppm" integer DEFAULT 0 NOT NULL,
	"earned_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_wip_lines_estimate_nonnegative" CHECK ("job_wip_lines"."estimate_cents" is null or "job_wip_lines"."estimate_cents" >= 0),
	CONSTRAINT "job_wip_lines_percent_range" CHECK ("job_wip_lines"."percent_complete_ppm" between 0 and 1000000),
	CONSTRAINT "job_wip_lines_reason_valid" CHECK ("job_wip_lines"."reason" in ('', 'no_value', 'no_estimate'))
);
--> statement-breakpoint
CREATE TABLE "job_wip_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"entry_id" uuid,
	"reversal_entry_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"posted_on" date,
	"posted_by_clerk_user_id" text,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_wip_periods_status_valid" CHECK ("job_wip_periods"."status" in ('draft', 'posted')),
	CONSTRAINT "job_wip_periods_posted_has_entry" CHECK (("job_wip_periods"."status" = 'posted') = ("job_wip_periods"."entry_id" is not null)),
	CONSTRAINT "job_wip_periods_reversal_needs_entry" CHECK ("job_wip_periods"."reversal_entry_id" is null or "job_wip_periods"."entry_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_wip_periods_tenant_id_id_idx" ON "job_wip_periods" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_period_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "public"."job_wip_periods"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_lines" ADD CONSTRAINT "job_wip_lines_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_periods" ADD CONSTRAINT "job_wip_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_periods" ADD CONSTRAINT "job_wip_periods_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_periods" ADD CONSTRAINT "job_wip_periods_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wip_periods" ADD CONSTRAINT "job_wip_periods_reversal_fk" FOREIGN KEY ("tenant_id","reversal_entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_wip_lines_tenant_id_id_idx" ON "job_wip_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_wip_lines_period_project_idx" ON "job_wip_lines" USING btree ("tenant_id","period_id","project_id");--> statement-breakpoint
CREATE INDEX "job_wip_lines_tenant_project_idx" ON "job_wip_lines" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_wip_periods_entity_period_idx" ON "job_wip_periods" USING btree ("tenant_id","entity_id","period_end");--> statement-breakpoint
CREATE INDEX "job_wip_periods_tenant_entity_idx" ON "job_wip_periods" USING btree ("tenant_id","entity_id","status");