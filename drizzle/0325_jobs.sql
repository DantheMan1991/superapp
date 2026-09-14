-- HAND-REORDERED, and the reason is load-bearing.
--
-- drizzle-kit emits every ADD CONSTRAINT before every CREATE INDEX. That is
-- fine when a composite FK points at a table from an earlier migration — the
-- unique index it needs is already there — and it FAILS when both tables are
-- new in the same file, which is the case here:
--
--   there is no unique constraint matching given keys for referenced table
--   "job_cost_code_sets"
--
-- A composite FK to `(tenant_id, id)` requires a UNIQUE index on exactly those
-- columns to exist FIRST. So `job_cost_code_sets_tenant_id_id_idx` is moved up
-- here, ahead of the two FKs that reference it (`job_cost_codes_set_fk` and
-- `job_projects_cost_code_set_fk`). Everything else is as generated.
--
-- Regenerating this file will undo the move. If `db:generate` is ever re-run
-- over these tables, check this ordering again before applying.

CREATE TABLE "job_cost_code_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cost_code_sets_name_present" CHECK (length(btrim("job_cost_code_sets"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "job_cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cost_codes_code_present" CHECK (length(btrim("job_cost_codes"."code")) > 0),
	CONSTRAINT "job_cost_codes_name_present" CHECK (length(btrim("job_cost_codes"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "job_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"party_id" uuid,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"delivery_method" text,
	"cost_code_set_id" uuid,
	"address" text DEFAULT '' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_projects_number_present" CHECK (length(btrim("job_projects"."number")) > 0),
	CONSTRAINT "job_projects_name_present" CHECK (length(btrim("job_projects"."name")) > 0),
	CONSTRAINT "job_projects_status_valid" CHECK ("job_projects"."status" in ('planned', 'active', 'on_hold', 'complete', 'cancelled')),
	CONSTRAINT "job_projects_delivery_method_format" CHECK ("job_projects"."delivery_method" is null or "job_projects"."delivery_method" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "job_projects_dates_ordered" CHECK ("job_projects"."ends_on" is null or "job_projects"."starts_on" is null or "job_projects"."ends_on" >= "job_projects"."starts_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_code_sets_tenant_id_id_idx" ON "job_cost_code_sets" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_cost_code_sets" ADD CONSTRAINT "job_cost_code_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_codes" ADD CONSTRAINT "job_cost_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_codes" ADD CONSTRAINT "job_cost_codes_set_fk" FOREIGN KEY ("tenant_id","set_id") REFERENCES "public"."job_cost_code_sets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_enterprise_fk" FOREIGN KEY ("tenant_id","enterprise_id") REFERENCES "public"."enterprises"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_cost_code_set_fk" FOREIGN KEY ("tenant_id","cost_code_set_id") REFERENCES "public"."job_cost_code_sets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_code_sets_tenant_name_idx" ON "job_cost_code_sets" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_code_sets_one_default_idx" ON "job_cost_code_sets" USING btree ("tenant_id") WHERE "job_cost_code_sets"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_codes_tenant_id_id_idx" ON "job_cost_codes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_codes_set_code_idx" ON "job_cost_codes" USING btree ("tenant_id","set_id","code");--> statement-breakpoint
CREATE INDEX "job_cost_codes_tenant_set_sort_idx" ON "job_cost_codes" USING btree ("tenant_id","set_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "job_projects_tenant_id_id_idx" ON "job_projects" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_projects_tenant_number_idx" ON "job_projects" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "job_projects_tenant_status_idx" ON "job_projects" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "job_projects_tenant_entity_idx" ON "job_projects" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE INDEX "job_projects_tenant_party_idx" ON "job_projects" USING btree ("tenant_id","party_id");