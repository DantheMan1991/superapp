-- What a walk proposes for a step, and where a line's number came from
-- (X2b, ADR 0098).
--
-- No hand-reordering this time, unlike 0389 and 0392: the only composite FK
-- points at job_estimate_interviews (tenant_id, id), whose unique index was
-- created back in 0392, so the target already exists.
--
-- `basis` on job_estimate_lines defaults to BLANK, which is not the same as
-- 'none'. Blank means nobody recorded where the number came from, and every
-- line written before today is blank. 'none' means a walk produced the line
-- and could not price it, which is a thing worth seeing on screen.

CREATE TABLE "job_estimate_proposed_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"step_id" uuid,
	"step_title" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"client_description" text DEFAULT '' NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity_thousandths" bigint DEFAULT 1000 NOT NULL,
	"unit_cost_cents" bigint DEFAULT 0 NOT NULL,
	"cost_code" text DEFAULT '' NOT NULL,
	"basis" text DEFAULT 'none' NOT NULL,
	"basis_detail" text DEFAULT '' NOT NULL,
	"quantity_basis" text DEFAULT 'none' NOT NULL,
	"quantity_note" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"estimate_line_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_proposed_lines_description_present" CHECK (length(btrim("job_estimate_proposed_lines"."description")) > 0),
	CONSTRAINT "job_estimate_proposed_lines_basis_valid" CHECK ("job_estimate_proposed_lines"."basis" in ('assembly', 'memory', 'said', 'none')),
	CONSTRAINT "job_estimate_proposed_lines_quantity_basis_valid" CHECK ("job_estimate_proposed_lines"."quantity_basis" in ('said', 'derived', 'none')),
	CONSTRAINT "job_estimate_proposed_lines_amounts_sane" CHECK ("job_estimate_proposed_lines"."quantity_thousandths" >= 0 and "job_estimate_proposed_lines"."unit_cost_cents" >= 0),
	CONSTRAINT "job_estimate_proposed_lines_derived_shows_working" CHECK (("job_estimate_proposed_lines"."quantity_basis" = 'derived') = (length(btrim("job_estimate_proposed_lines"."quantity_note")) > 0)),
	CONSTRAINT "job_estimate_proposed_lines_applied_whole" CHECK (("job_estimate_proposed_lines"."estimate_line_id" is null) = ("job_estimate_proposed_lines"."applied_at" is null))
);
--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD COLUMN "basis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD COLUMN "basis_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" ADD CONSTRAINT "job_estimate_proposed_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" ADD CONSTRAINT "job_estimate_proposed_lines_interview_fk" FOREIGN KEY ("tenant_id","interview_id") REFERENCES "public"."job_estimate_interviews"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_proposed_lines_tenant_id_id_idx" ON "job_estimate_proposed_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_estimate_proposed_lines_tenant_interview_idx" ON "job_estimate_proposed_lines" USING btree ("tenant_id","interview_id","sort_order");--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_basis_valid" CHECK ("job_estimate_lines"."basis" in ('', 'assembly', 'memory', 'said', 'none'));