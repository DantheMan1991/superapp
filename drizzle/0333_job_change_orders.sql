-- HAND-REORDERED, the same way drizzle/0325_jobs.sql and 0329_job_commitments.sql
-- are, and for the same reason: drizzle-kit emits every ADD CONSTRAINT before
-- every CREATE INDEX, which fails when two NEW tables in one file reference
-- each other.
--
-- `job_change_order_lines_co_fk` points at `job_change_orders(tenant_id, id)`,
-- and a composite FK needs a UNIQUE index on exactly those columns to exist
-- FIRST. So `job_change_orders_tenant_id_id_idx` is moved up here, ahead of the
-- constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_change_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_order_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"requested_on" date,
	"approved_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_change_orders_number_present" CHECK (length(btrim("job_change_orders"."number")) > 0),
	CONSTRAINT "job_change_orders_title_present" CHECK (length(btrim("job_change_orders"."title")) > 0),
	CONSTRAINT "job_change_orders_status_valid" CHECK ("job_change_orders"."status" in ('proposed', 'approved', 'declined', 'void')),
	CONSTRAINT "job_change_orders_approved_has_date" CHECK (("job_change_orders"."status" = 'approved') = ("job_change_orders"."approved_on" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_change_orders_tenant_id_id_idx" ON "job_change_orders" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_change_order_lines" ADD CONSTRAINT "job_change_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_change_order_lines" ADD CONSTRAINT "job_change_order_lines_co_fk" FOREIGN KEY ("tenant_id","change_order_id") REFERENCES "public"."job_change_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_change_order_lines" ADD CONSTRAINT "job_change_order_lines_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_change_orders" ADD CONSTRAINT "job_change_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_change_orders" ADD CONSTRAINT "job_change_orders_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_change_order_lines_tenant_id_id_idx" ON "job_change_order_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_change_order_lines_tenant_co_idx" ON "job_change_order_lines" USING btree ("tenant_id","change_order_id","sort_order");--> statement-breakpoint
CREATE INDEX "job_change_order_lines_tenant_code_idx" ON "job_change_order_lines" USING btree ("tenant_id","cost_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_change_orders_contract_number_idx" ON "job_change_orders" USING btree ("tenant_id","contract_id","number");--> statement-breakpoint
CREATE INDEX "job_change_orders_tenant_contract_idx" ON "job_change_orders" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "job_change_orders_tenant_status_idx" ON "job_change_orders" USING btree ("tenant_id","status");