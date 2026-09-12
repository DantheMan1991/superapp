-- Time slice 0: the people whose hours the business keeps, the hours
-- themselves, and the one setting a week needs. See docs/modules/time.md.
--
-- HAND-REORDERED, and it has to be. drizzle-kit emits every ALTER TABLE … ADD
-- CONSTRAINT before every CREATE INDEX, which cannot work when a composite FK
-- points at a table born in the SAME migration: `time_entries` references
-- `time_workers (tenant_id, id)`, and Postgres refuses an FK whose referenced
-- columns have no unique index yet. `time_workers_tenant_id_id_idx` therefore
-- moves ABOVE that constraint. Migrations 0276 (livestock breeding) and 0295
-- (professional services) each paid for this lesson first; the `when` in
-- meta/_journal.json is untouched, because only the statement order inside the
-- file changed.

CREATE TABLE "time_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"clerk_user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"work_date" date NOT NULL,
	"pay_type" text DEFAULT 'worked' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"entered_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_minutes_positive" CHECK ("time_entries"."minutes" > 0),
	CONSTRAINT "time_entries_minutes_within_a_day" CHECK ("time_entries"."minutes" <= 1440),
	CONSTRAINT "time_entries_pay_type" CHECK ("time_entries"."pay_type" in ('worked', 'paid_leave', 'holiday', 'unpaid'))
);
--> statement-breakpoint
CREATE TABLE "time_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"week_starts_on" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_settings_week_starts_on" CHECK ("time_settings"."week_starts_on" between 0 and 6)
);
--> statement-breakpoint
-- MOVED UP from the generated order: `time_entries_worker_fk` below references
-- these two columns and Postgres needs the unique index to exist first.
CREATE UNIQUE INDEX "time_workers_tenant_id_id_idx" ON "time_workers" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "time_workers" ADD CONSTRAINT "time_workers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_workers" ADD CONSTRAINT "time_workers_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_worker_fk" FOREIGN KEY ("tenant_id","worker_id") REFERENCES "public"."time_workers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_workers_tenant_party_idx" ON "time_workers" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_workers_tenant_user_idx" ON "time_workers" USING btree ("tenant_id","clerk_user_id") WHERE "time_workers"."clerk_user_id" is not null;--> statement-breakpoint
CREATE INDEX "time_workers_tenant_active_idx" ON "time_workers" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_tenant_id_id_idx" ON "time_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_date_idx" ON "time_entries" USING btree ("tenant_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_worker_date_idx" ON "time_entries" USING btree ("tenant_id","worker_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "time_settings_tenant_idx" ON "time_settings" USING btree ("tenant_id");
