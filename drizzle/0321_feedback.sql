-- Feedback, slice 0: the two tables. RLS is the next migration, 0322.
--
-- HAND-REORDERED, and it will not apply otherwise. drizzle-kit emitted every
-- ALTER TABLE ... ADD CONSTRAINT before every CREATE INDEX, which puts
-- `feedback_messages_report_fk` — a COMPOSITE foreign key on
-- (tenant_id, report_id) — ahead of the unique index on
-- feedback_reports (tenant_id, id) that it references. Postgres refuses a
-- foreign key whose target columns carry no unique constraint, so the
-- generated order fails on a fresh database with:
--
--   there is no unique constraint matching given keys for referenced table
--
-- The unique index therefore moves ABOVE the constraints below. Same trap
-- production's migration 0295 hit and wrote up; it is a property of a
-- composite FK to a table born in the SAME migration, so any future child
-- table of `feedback_reports` will hit it again.

CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"reporter_name" text DEFAULT '' NOT NULL,
	"reporter_email" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"route" text DEFAULT '' NOT NULL,
	"route_query" text DEFAULT '' NOT NULL,
	"feature_slug" text DEFAULT '' NOT NULL,
	"surface" text DEFAULT 'browser' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"viewport" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"client_read_at" timestamp with time zone,
	"operator_read_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_kind" CHECK ("feedback_reports"."kind" in ('bug', 'idea', 'question')),
	CONSTRAINT "feedback_reports_status" CHECK ("feedback_reports"."status" in ('new', 'needs_info', 'planned', 'in_progress', 'done', 'declined')),
	CONSTRAINT "feedback_reports_surface" CHECK ("feedback_reports"."surface" in ('app', 'browser'))
);
--> statement-breakpoint
CREATE TABLE "feedback_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"side" text NOT NULL,
	"clerk_user_id" text DEFAULT '' NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_messages_side" CHECK ("feedback_messages"."side" in ('client', 'operator')),
	CONSTRAINT "feedback_messages_internal_is_operators" CHECK ("feedback_messages"."internal" = false OR "feedback_messages"."side" = 'operator')
);
--> statement-breakpoint
-- MOVED UP from the bottom of the generated file: the composite FK below
-- cannot be created until this exists. See the header.
CREATE UNIQUE INDEX "feedback_reports_tenant_id_id_idx" ON "feedback_reports" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."feedback_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_messages_thread_idx" ON "feedback_messages" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_reporter_idx" ON "feedback_reports" USING btree ("tenant_id","clerk_user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_status_idx" ON "feedback_reports" USING btree ("status","created_at");
