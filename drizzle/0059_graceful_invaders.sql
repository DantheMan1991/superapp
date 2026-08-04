-- The party spine — EXPAND step 1 of 3. Generated, then hand-edited; the edit
-- is described below so the next `db:generate` diff makes sense.
--
-- WHAT WAS CHANGED BY HAND, and why it had to be. drizzle-kit read
-- `partyId: uuid("party_id").notNull()` in schema.ts and emitted
-- `ADD COLUMN "party_id" uuid NOT NULL` for both role tables. That statement
-- fails outright on a table with rows in it, and `customers`/`vendors` hold
-- live AR and AP data. So both columns are added NULLABLE here and enforced in
-- 0062, after 0061's triggers are covering the running code and the backfill
-- has run. schema.ts states the SETTLED shape; these three migrations are the
-- only place the sequence to reach it exists.
--
-- THE 0023/0025 RULE APPLIES AND IS THE WHOLE REASON FOR THE SPLIT. This repo
-- migrates a live database AHEAD of the deploy, so every migration must leave
-- the CURRENTLY RUNNING code working. The code deployed right now knows nothing
-- about `party_id`; a nullable column is invisible to it, so this migration is
-- a no-op from its point of view. Expand, deploy, contract.
--
-- The unique indexes DO land here rather than in the contract migration, and
-- that is safe: NULLS DISTINCT is the Postgres default, so the rows that have
-- no party yet cannot collide with each other. Having them in place from the
-- start means a trigger-minted party can never double up on a role.

CREATE TYPE "public"."party_kind" AS ENUM('person', 'organization');--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "party_kind" NOT NULL,
	"display_name" text NOT NULL,
	"given_name" text,
	"family_name" text,
	"legal_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- HAND-EDITED: `NOT NULL` removed from both. Enforced in 0062.
ALTER TABLE "customers" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_tenant_id_id_idx" ON "parties" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "parties_tenant_idx" ON "parties" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_party_idx" ON "customers" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_tenant_party_idx" ON "vendors" USING btree ("tenant_id","party_id");
