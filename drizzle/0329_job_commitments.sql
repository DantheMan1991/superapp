-- HAND-REORDERED, the same way drizzle/0325_jobs.sql is, and for the same
-- reason: drizzle-kit emits every ADD CONSTRAINT before every CREATE INDEX,
-- which fails when two NEW tables in one file reference each other.
--
-- `job_commitment_lines_commitment_fk` points at `job_commitments(tenant_id,
-- id)`, and a composite FK needs a UNIQUE index on exactly those columns to
-- exist FIRST. So `job_commitments_tenant_id_id_idx` is moved up here, ahead of
-- the constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_commitment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"cost_code_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_commitment_lines_amount_nonnegative" CHECK ("job_commitment_lines"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text DEFAULT 'purchase_order' NOT NULL,
	"number" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_commitments_number_present" CHECK (length(btrim("job_commitments"."number")) > 0),
	CONSTRAINT "job_commitments_kind_valid" CHECK ("job_commitments"."kind" in ('purchase_order', 'subcontract')),
	CONSTRAINT "job_commitments_status_valid" CHECK ("job_commitments"."status" in ('draft', 'issued', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_commitments_tenant_id_id_idx" ON "job_commitments" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD CONSTRAINT "job_commitment_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD CONSTRAINT "job_commitment_lines_commitment_fk" FOREIGN KEY ("tenant_id","commitment_id") REFERENCES "public"."job_commitments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD CONSTRAINT "job_commitment_lines_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitments" ADD CONSTRAINT "job_commitments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitments" ADD CONSTRAINT "job_commitments_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitments" ADD CONSTRAINT "job_commitments_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_commitment_lines_tenant_id_id_idx" ON "job_commitment_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_commitment_lines_tenant_commitment_idx" ON "job_commitment_lines" USING btree ("tenant_id","commitment_id","sort_order");--> statement-breakpoint
CREATE INDEX "job_commitment_lines_tenant_code_idx" ON "job_commitment_lines" USING btree ("tenant_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_commitments_tenant_number_idx" ON "job_commitments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "job_commitments_tenant_project_idx" ON "job_commitments" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_commitments_tenant_party_idx" ON "job_commitments" USING btree ("tenant_id","party_id");