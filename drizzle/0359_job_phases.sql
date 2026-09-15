-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333, 0335, 0337, 0339,
-- 0343, 0348, 0352 and 0356 are, and for the same reason: drizzle-kit emits
-- every ADD CONSTRAINT before every CREATE INDEX, which fails when a NEW
-- table references ITSELF. `job_phases_predecessor_fk` points at
-- `job_phases(tenant_id, id)`, and a composite FK needs a UNIQUE index on
-- exactly those columns to exist FIRST, so `job_phases_tenant_id_id_idx` is
-- moved up ahead of the constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'phase' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"predecessor_id" uuid,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"party_id" uuid,
	"cost_code_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_phases_name_present" CHECK (length(btrim("job_phases"."name")) > 0),
	CONSTRAINT "job_phases_kind_valid" CHECK ("job_phases"."kind" in ('phase', 'milestone')),
	CONSTRAINT "job_phases_status_valid" CHECK ("job_phases"."status" in ('planned', 'underway', 'done')),
	CONSTRAINT "job_phases_no_self_predecessor" CHECK ("job_phases"."predecessor_id" is distinct from "job_phases"."id"),
	CONSTRAINT "job_phases_lag_within_a_year" CHECK ("job_phases"."lag_days" between -365 and 365)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_phases_tenant_id_id_idx" ON "job_phases" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."schedule_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_predecessor_fk" FOREIGN KEY ("tenant_id","predecessor_id") REFERENCES "public"."job_phases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_phases" ADD CONSTRAINT "job_phases_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_phases_item_idx" ON "job_phases" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "job_phases_tenant_project_idx" ON "job_phases" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_phases_tenant_predecessor_idx" ON "job_phases" USING btree ("tenant_id","predecessor_id");