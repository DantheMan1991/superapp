-- X7: the house's own numbers, and the list of what to measure.
--
-- TWO COMPOSITE FKs SET NULL HERE, IN THE COLUMN-LIST FORM PG 15 ADDED.
-- drizzle-kit emits a bare `ON DELETE set null` for a `(tenant_id, x)` FK and
-- that constraint can NEVER fire: it would null `tenant_id` too, which is NOT
-- NULL, so the delete fails instead of clearing the link. Rewritten by hand to
-- `SET NULL ("sheet_id")` / `SET NULL ("markup_id")`. `db:generate` re-emits
-- the bare form on snapshot drift, so check `pg_constraint` rather than this
-- file after a regenerate (ADR 0046, and docs/modules/jobs.md).
--
-- A deleted markup must not take the measurement with it. The number was true
-- when it was taken; losing the trace loses the provenance, not the fact.

CREATE TABLE "job_estimate_outline_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outline_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'length' NOT NULL,
	"guidance" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_outline_measures_name_present" CHECK (length(btrim("job_estimate_outline_measures"."name")) > 0),
	CONSTRAINT "job_estimate_outline_measures_kind_valid" CHECK ("job_estimate_outline_measures"."kind" in ('length', 'area', 'count'))
);
--> statement-breakpoint
CREATE TABLE "job_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"value_thousandths" bigint,
	"source" text DEFAULT 'said' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"passed_at" timestamp with time zone,
	"sheet_id" uuid,
	"markup_id" uuid,
	"taken_by_clerk_user_id" text,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_measurements_name_present" CHECK (length(btrim("job_measurements"."name")) > 0),
	CONSTRAINT "job_measurements_slug_present" CHECK (length(btrim("job_measurements"."slug")) > 0),
	CONSTRAINT "job_measurements_source_valid" CHECK ("job_measurements"."source" in ('measured', 'said', 'derived')),
	CONSTRAINT "job_measurements_answered" CHECK ("job_measurements"."value_thousandths" is not null or "job_measurements"."passed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "job_estimate_outline_measures" ADD CONSTRAINT "job_estimate_outline_measures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_outline_measures" ADD CONSTRAINT "job_estimate_outline_measures_outline_fk" FOREIGN KEY ("tenant_id","outline_id") REFERENCES "public"."job_estimate_outlines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_measurements" ADD CONSTRAINT "job_measurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_measurements" ADD CONSTRAINT "job_measurements_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_measurements" ADD CONSTRAINT "job_measurements_sheet_fk" FOREIGN KEY ("tenant_id","sheet_id") REFERENCES "public"."job_sheets"("tenant_id","id") ON DELETE SET NULL ("sheet_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_measurements" ADD CONSTRAINT "job_measurements_markup_fk" FOREIGN KEY ("tenant_id","markup_id") REFERENCES "public"."job_sheet_markups"("tenant_id","id") ON DELETE SET NULL ("markup_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outline_measures_tenant_id_id_idx" ON "job_estimate_outline_measures" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_outline_measures_tenant_outline_name_idx" ON "job_estimate_outline_measures" USING btree ("tenant_id","outline_id","name");--> statement-breakpoint
CREATE INDEX "job_estimate_outline_measures_tenant_outline_sort_idx" ON "job_estimate_outline_measures" USING btree ("tenant_id","outline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "job_measurements_tenant_id_id_idx" ON "job_measurements" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_measurements_tenant_project_slug_idx" ON "job_measurements" USING btree ("tenant_id","project_id","slug");--> statement-breakpoint
CREATE INDEX "job_measurements_tenant_project_idx" ON "job_measurements" USING btree ("tenant_id","project_id");