-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333, 0335, 0337, 0339,
-- 0343 and 0348 are, and for the same reason: drizzle-kit emits every ADD
-- CONSTRAINT before every CREATE INDEX, which fails when two NEW tables in one
-- file reference each other. `job_selection_choices_selection_fk` points at
-- `job_selections(tenant_id, id)`, and a composite FK needs a UNIQUE index on
-- exactly those columns to exist FIRST, so `job_selections_tenant_id_id_idx`
-- is moved up ahead of the constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_selection_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"party_id" uuid,
	"description" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity_thousandths" bigint,
	"unit_price_cents" bigint,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_selection_choices_description_present" CHECK (length(btrim("job_selection_choices"."description")) > 0),
	CONSTRAINT "job_selection_choices_price_nonnegative" CHECK ("job_selection_choices"."price_cents" >= 0),
	CONSTRAINT "job_selection_choices_quantity_nonnegative" CHECK ("job_selection_choices"."quantity_thousandths" is null or "job_selection_choices"."quantity_thousandths" >= 0),
	CONSTRAINT "job_selection_choices_unit_price_nonnegative" CHECK ("job_selection_choices"."unit_price_cents" is null or "job_selection_choices"."unit_price_cents" >= 0),
	CONSTRAINT "job_selection_choices_unit_pair" CHECK (("job_selection_choices"."quantity_thousandths" is null) = ("job_selection_choices"."unit_price_cents" is null))
);
--> statement-breakpoint
CREATE TABLE "job_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"change_order_id" uuid,
	"cost_code_id" uuid,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"allowance_cents" bigint DEFAULT 0 NOT NULL,
	"needed_by" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_selections_name_present" CHECK (length(btrim("job_selections"."name")) > 0),
	CONSTRAINT "job_selections_status_valid" CHECK ("job_selections"."status" in ('pending', 'selected', 'approved', 'cancelled')),
	CONSTRAINT "job_selections_allowance_nonnegative" CHECK ("job_selections"."allowance_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_selections_tenant_id_id_idx" ON "job_selections" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_selection_choices" ADD CONSTRAINT "job_selection_choices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selection_choices" ADD CONSTRAINT "job_selection_choices_selection_fk" FOREIGN KEY ("tenant_id","selection_id") REFERENCES "public"."job_selections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selection_choices" ADD CONSTRAINT "job_selection_choices_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_change_order_fk" FOREIGN KEY ("tenant_id","change_order_id") REFERENCES "public"."job_change_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_selection_choices_tenant_id_id_idx" ON "job_selection_choices" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_selection_choices_tenant_selection_idx" ON "job_selection_choices" USING btree ("tenant_id","selection_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "job_selection_choices_one_chosen_idx" ON "job_selection_choices" USING btree ("tenant_id","selection_id") WHERE "job_selection_choices"."is_selected";--> statement-breakpoint
CREATE INDEX "job_selections_tenant_project_idx" ON "job_selections" USING btree ("tenant_id","project_id","sort_order");--> statement-breakpoint
CREATE INDEX "job_selections_tenant_contract_idx" ON "job_selections" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "job_selections_tenant_status_idx" ON "job_selections" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "job_selections_tenant_needed_idx" ON "job_selections" USING btree ("tenant_id","needed_by");