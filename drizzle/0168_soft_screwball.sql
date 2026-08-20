-- Production slice 0 - the run model, and outputs landing in inventory.
--
-- HAND-REORDERED. Eighth time the question has been asked, third time the
-- answer was yes. The rule is *check whether the FK's target is created in the
-- same migration*, not *always reorder* - and here BOTH answers appear in one
-- file:
--
--   * `production_run_inputs_run_fk` and `production_run_outputs_run_fk` point
--     at `production_runs(tenant_id, id)`, which is created RIGHT HERE and whose
--     unique index drizzle emitted at the very bottom. A composite FK needs a
--     unique index on its target, so both would have failed. The index is
--     hoisted above them.
--   * every other FK in the file targets `inventory_items`, `inventory_lots`,
--     `inventory_movements` or `assets` - all pre-existing, all already indexed,
--     and all fine exactly where drizzle put them.

CREATE TABLE "production_run_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"weight_lb" numeric(18, 4),
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_inputs_weight_positive" CHECK ("production_run_inputs"."weight_lb" is null or "production_run_inputs"."weight_lb" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_run_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"weight_lb" numeric(18, 4),
	"lot_code" text NOT NULL,
	"lot_id" uuid,
	"inventory_movement_id" uuid,
	"location_asset_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_outputs_quantity_positive" CHECK ("production_run_outputs"."quantity" > 0),
	CONSTRAINT "production_run_outputs_weight_positive" CHECK ("production_run_outputs"."weight_lb" is null or "production_run_outputs"."weight_lb" > 0),
	CONSTRAINT "production_run_outputs_lot_code_present" CHECK (length(btrim("production_run_outputs"."lot_code")) > 0),
	CONSTRAINT "production_run_outputs_landed_together" CHECK (("production_run_outputs"."lot_id" is null) = ("production_run_outputs"."inventory_movement_id" is null))
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"run_kind" text DEFAULT 'run' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_on" date NOT NULL,
	"completed_on" date,
	"location_asset_id" uuid,
	"performed_by" text DEFAULT '' NOT NULL,
	"crew_size" integer,
	"labour_hours" numeric(18, 2),
	"cost_basis" text,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_runs_code_present" CHECK (length(btrim("production_runs"."code")) > 0),
	CONSTRAINT "production_runs_kind_format" CHECK ("production_runs"."run_kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_runs_status_valid" CHECK ("production_runs"."status" in ('in_progress', 'complete')),
	CONSTRAINT "production_runs_basis_valid" CHECK ("production_runs"."cost_basis" is null or "production_runs"."cost_basis" in ('weight', 'quantity', 'none')),
	CONSTRAINT "production_runs_completed_after_started" CHECK ("production_runs"."completed_on" is null or "production_runs"."completed_on" >= "production_runs"."started_on"),
	CONSTRAINT "production_runs_crew_positive" CHECK ("production_runs"."crew_size" is null or "production_runs"."crew_size" > 0),
	CONSTRAINT "production_runs_hours_positive" CHECK ("production_runs"."labour_hours" is null or "production_runs"."labour_hours" > 0)
);
--> statement-breakpoint
-- Hoisted: the two composite FKs below point at it, and it is created here.
CREATE UNIQUE INDEX "production_runs_tenant_id_id_idx" ON "production_runs" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."inventory_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_outputs" ADD CONSTRAINT "production_run_outputs_location_fk" FOREIGN KEY ("tenant_id","location_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_location_fk" FOREIGN KEY ("tenant_id","location_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_inputs_tenant_id_id_idx" ON "production_run_inputs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_run_inputs_tenant_run_idx" ON "production_run_inputs" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_inputs_movement_idx" ON "production_run_inputs" USING btree ("tenant_id","inventory_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_outputs_tenant_id_id_idx" ON "production_run_outputs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_run_outputs_tenant_run_idx" ON "production_run_outputs" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "production_run_outputs_tenant_item_idx" ON "production_run_outputs" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "production_runs_tenant_status_idx" ON "production_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "production_runs_tenant_started_idx" ON "production_runs" USING btree ("tenant_id","started_on");--> statement-breakpoint
CREATE INDEX "production_runs_tenant_kind_idx" ON "production_runs" USING btree ("tenant_id","run_kind");