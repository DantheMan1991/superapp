-- professional-services pack (back-office slice 7b): engagements, the retainer
-- hours agreed per month, and the time logged against them.
--
-- HAND-REORDERED, and it has to be. drizzle-kit emits every ALTER TABLE … ADD
-- CONSTRAINT before every CREATE INDEX, which cannot work when a composite FK
-- points at a table born in the SAME migration: `ps_engagement_allotments` and
-- `ps_time_entries` reference `ps_engagements (tenant_id, id)`, and Postgres
-- refuses an FK whose referenced columns have no unique index yet. The unique
-- index therefore moves ABOVE those two constraints. Migration 0276 paid for
-- this lesson first (livestock breeding); the `when` in meta/_journal.json is
-- untouched, because only the statement order inside the file changed.

CREATE TABLE "ps_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'retainer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"fee_cents" bigint,
	"rate_cents" bigint,
	"retainer_minutes_monthly" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ps_engagements_kind_format" CHECK ("ps_engagements"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "ps_engagements_status_valid" CHECK ("ps_engagements"."status" in ('proposed', 'active', 'paused', 'ended')),
	CONSTRAINT "ps_engagements_retainer_nonnegative" CHECK ("ps_engagements"."retainer_minutes_monthly" >= 0),
	CONSTRAINT "ps_engagements_fee_nonnegative" CHECK ("ps_engagements"."fee_cents" is null or "ps_engagements"."fee_cents" >= 0),
	CONSTRAINT "ps_engagements_rate_nonnegative" CHECK ("ps_engagements"."rate_cents" is null or "ps_engagements"."rate_cents" >= 0),
	CONSTRAINT "ps_engagements_ends_after_start" CHECK ("ps_engagements"."ends_on" is null or "ps_engagements"."ends_on" >= "ps_engagements"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "ps_engagement_allotments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"effective_month" text NOT NULL,
	"included_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ps_engagement_allotments_month_format" CHECK ("ps_engagement_allotments"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ps_engagement_allotments_nonnegative" CHECK ("ps_engagement_allotments"."included_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ps_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"work_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ps_time_entries_minutes_positive" CHECK ("ps_time_entries"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "ps_engagements" ADD CONSTRAINT "ps_engagements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- NO CASCADE, deliberately. The CRM's merge deletes the losing identity LAST
-- (src/modules/crm/merge-ops.ts step 8) precisely so a reference it did not
-- know to re-point fails on the key and rolls the merge back. A cascade here
-- would instead take a client's engagements and their whole time log with it.
ALTER TABLE "ps_engagements" ADD CONSTRAINT "ps_engagements_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_engagement_allotments" ADD CONSTRAINT "ps_engagement_allotments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_time_entries" ADD CONSTRAINT "ps_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ps_engagements_tenant_id_id_idx" ON "ps_engagements" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ps_engagement_allotments" ADD CONSTRAINT "ps_engagement_allotments_engagement_fk" FOREIGN KEY ("tenant_id","engagement_id") REFERENCES "public"."ps_engagements"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ps_time_entries" ADD CONSTRAINT "ps_time_entries_engagement_fk" FOREIGN KEY ("tenant_id","engagement_id") REFERENCES "public"."ps_engagements"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ps_engagement_allotments_month_idx" ON "ps_engagement_allotments" USING btree ("tenant_id","engagement_id","effective_month");--> statement-breakpoint
CREATE INDEX "ps_engagements_tenant_party_idx" ON "ps_engagements" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "ps_engagements_tenant_status_idx" ON "ps_engagements" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_time_entries_tenant_id_id_idx" ON "ps_time_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ps_time_entries_engagement_date_idx" ON "ps_time_entries" USING btree ("tenant_id","engagement_id","work_date");
