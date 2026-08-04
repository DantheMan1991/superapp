-- CRM slice 3 — pipelines, stages, deals, stage history, deal parties.
--
-- HAND-EDITED FOR STATEMENT ORDER, and the original failed outright rather than
-- doing something subtle, so this is worth recording.
--
-- drizzle-kit emits every CREATE TABLE, then every ADD CONSTRAINT, then every
-- CREATE INDEX. That order is fine whenever a composite foreign key points at a
-- table from an EARLIER migration — `parties_tenant_id_id_idx` has existed since
-- 0059, so 0063's FKs found it. It breaks the moment a migration creates both
-- ends: `crm_deal_parties` and `crm_deal_stage_events` reference
-- `crm_deals (tenant_id, id)`, and Postgres refuses with
--
--     42830: there is no unique constraint matching given keys
--            for referenced table "crm_deals"
--
-- because the unique index backing that key was still forty lines away.
--
-- The fix is ordering only — no constraint was added, removed or weakened. The
-- three `(tenant_id, id)` unique indexes now come immediately after their
-- tables and before any foreign key that depends on them. Everything else keeps
-- drizzle's order so the next `db:generate` diff stays readable.
--
-- Worth knowing for slice 4: any future migration that creates a parent and a
-- child together needs the same edit.

CREATE TYPE "public"."crm_deal_outcome" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "crm_deal_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_deal_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by_clerk_user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"primary_contact_party_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_cents" bigint,
	"expected_close_on" date,
	"owner_clerk_user_id" text,
	"closed_at" timestamp with time zone,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_deals_amount_nonnegative" CHECK ("crm_deals"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"outcome" "crm_deal_outcome" DEFAULT 'open' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipeline_stages_probability" CHECK ("crm_pipeline_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- HAND-EDITED: hoisted. These three back the composite foreign keys below and
-- must exist before them.
CREATE UNIQUE INDEX "crm_pipelines_tenant_id_id_idx" ON "crm_pipelines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_tenant_id_id_idx" ON "crm_pipeline_stages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deals_tenant_id_id_idx" ON "crm_deals" USING btree ("tenant_id","id");--> statement-breakpoint

ALTER TABLE "crm_deal_parties" ADD CONSTRAINT "crm_deal_parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_parties" ADD CONSTRAINT "crm_deal_parties_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."crm_deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_parties" ADD CONSTRAINT "crm_deal_parties_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_events" ADD CONSTRAINT "crm_deal_stage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_events" ADD CONSTRAINT "crm_deal_stage_events_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."crm_deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contact_fk" FOREIGN KEY ("tenant_id","primary_contact_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."crm_pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "public"."crm_pipeline_stages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."crm_pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deal_parties_tenant_id_id_idx" ON "crm_deal_parties" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deal_parties_unique_idx" ON "crm_deal_parties" USING btree ("tenant_id","deal_id","party_id");--> statement-breakpoint
CREATE INDEX "crm_deal_parties_party_idx" ON "crm_deal_parties" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deal_stage_events_tenant_id_id_idx" ON "crm_deal_stage_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "crm_deal_stage_events_deal_idx" ON "crm_deal_stage_events" USING btree ("tenant_id","deal_id","changed_at");--> statement-breakpoint
CREATE INDEX "crm_deals_board_idx" ON "crm_deals" USING btree ("tenant_id","pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "crm_deals_party_idx" ON "crm_deals" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "crm_deals_owner_idx" ON "crm_deals" USING btree ("tenant_id","owner_clerk_user_id");--> statement-breakpoint
CREATE INDEX "crm_pipeline_stages_pipeline_idx" ON "crm_pipeline_stages" USING btree ("tenant_id","pipeline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_default_idx" ON "crm_pipelines" USING btree ("tenant_id") WHERE is_default = true and archived_at is null;--> statement-breakpoint
CREATE INDEX "crm_pipelines_tenant_sort_idx" ON "crm_pipelines" USING btree ("tenant_id","sort_order");
