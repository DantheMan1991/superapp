-- Time slice 3: submit, approve, lock. `time_periods` (the lock),
-- `time_sheets` (worker x period), and the amendment link on `time_entries`.
-- See docs/modules/time.md.
--
-- Statement order is drizzle's own and is already right: both composite FKs
-- point at unique indexes that 0300 created, and the self-referential
-- `time_entries_amends_fk` needs `time_entries_tenant_id_id_idx`, which has
-- existed since the table did.
--
-- `time_entries_amends_fk` is ON DELETE NO ACTION on purpose, where the other
-- FKs in this module cascade or set null. An entry somebody has amended is the
-- evidence for the correction; deleting it would leave a correction of nothing,
-- and the entry is inside a locked period anyway, where nothing may be deleted.

CREATE TABLE "time_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_periods_ends_after_start" CHECK ("time_periods"."ends_on" >= "time_periods"."starts_on"),
	CONSTRAINT "time_periods_locked_pair" CHECK (("time_periods"."locked_at" is null) = ("time_periods"."locked_by_clerk_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "time_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"period_starts_on" date NOT NULL,
	"period_ends_on" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_clerk_user_id" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_clerk_user_id" text,
	"worked_minutes" integer,
	"regular_minutes" integer,
	"overtime_minutes" integer,
	"double_time_minutes" integer,
	"paid_leave_minutes" integer,
	"ruleset_slug" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_sheets_ends_after_start" CHECK ("time_sheets"."period_ends_on" >= "time_sheets"."period_starts_on"),
	CONSTRAINT "time_sheets_approved_pair" CHECK (("time_sheets"."approved_at" is null) = ("time_sheets"."approved_by_clerk_user_id" is null)),
	CONSTRAINT "time_sheets_snapshot_with_approval" CHECK (("time_sheets"."approved_at" is null) = ("time_sheets"."worked_minutes" is null))
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "amends_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "time_periods" ADD CONSTRAINT "time_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_worker_fk" FOREIGN KEY ("tenant_id","worker_id") REFERENCES "public"."time_workers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_periods_tenant_id_id_idx" ON "time_periods" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_periods_tenant_start_idx" ON "time_periods" USING btree ("tenant_id","starts_on");--> statement-breakpoint
CREATE INDEX "time_periods_tenant_range_idx" ON "time_periods" USING btree ("tenant_id","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "time_sheets_tenant_id_id_idx" ON "time_sheets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_sheets_tenant_worker_period_idx" ON "time_sheets" USING btree ("tenant_id","worker_id","period_starts_on");--> statement-breakpoint
CREATE INDEX "time_sheets_tenant_awaiting_idx" ON "time_sheets" USING btree ("tenant_id","approved_at");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_amends_fk" FOREIGN KEY ("tenant_id","amends_entry_id") REFERENCES "public"."time_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_amends_not_self" CHECK ("time_entries"."amends_entry_id" <> "time_entries"."id");