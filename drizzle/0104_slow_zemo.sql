-- Work, slice 0: two tables. RLS is the next migration.
--
-- ============================================================================
-- HAND-REORDERED. REGENERATING THIS FILE SILENTLY UNDOES THE FIX.
-- ============================================================================
--
-- drizzle-kit emits every `ADD CONSTRAINT` before every `CREATE INDEX`, so the
-- composite foreign keys below referenced `work_lists(tenant_id, id)` and
-- `work_items(tenant_id, id)` before those unique indexes existed — Postgres
-- 42830, "there is no unique constraint matching given keys for referenced
-- table". The generated order cannot run at all.
--
-- The two unique indexes the composite FKs point at are therefore created
-- FIRST, and everything else keeps drizzle's order. 0096 hit this same thing
-- for scheduling and carries the same warning; it is a property of the
-- generator, not of this schema, so expect it again on the next module.

CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'todo' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"due_on" date,
	"starts_on" date,
	"assignee_clerk_user_id" text,
	"parent_id" uuid,
	"kind" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_clerk_user_id" text,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_state" CHECK ("work_items"."state" in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
	CONSTRAINT "work_items_closed_matches_state" CHECK (("work_items"."state" in ('done', 'cancelled')) = ("work_items"."closed_at" is not null)),
	CONSTRAINT "work_items_closed_pair" CHECK (("work_items"."closed_at" is null) = ("work_items"."closed_by_clerk_user_id" is null)),
	CONSTRAINT "work_items_starts_before_due" CHECK ("work_items"."starts_on" is null or "work_items"."due_on" is null or "work_items"."starts_on" <= "work_items"."due_on"),
	CONSTRAINT "work_items_no_self_parent" CHECK ("work_items"."parent_id" is distinct from "work_items"."id")
);
--> statement-breakpoint
CREATE TABLE "work_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_lists_visibility" CHECK ("work_lists"."visibility" in ('members', 'owners'))
);
--> statement-breakpoint
-- MOVED UP from the bottom of the generated file: the two composite FKs below
-- reference these exact pairs, and a foreign key needs a unique index on the
-- referenced columns to already exist.
CREATE UNIQUE INDEX "work_lists_tenant_id_id_idx" ON "work_lists" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_tenant_id_id_idx" ON "work_items" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_list_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."work_lists"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_lists" ADD CONSTRAINT "work_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_list_idx" ON "work_items" USING btree ("tenant_id","list_id","due_on");--> statement-breakpoint
CREATE INDEX "work_items_assignee_open_idx" ON "work_items" USING btree ("tenant_id","assignee_clerk_user_id","due_on") WHERE "work_items"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "work_items_parent_idx" ON "work_items" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_lists_default_idx" ON "work_lists" USING btree ("tenant_id") WHERE "work_lists"."is_default";
