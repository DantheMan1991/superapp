-- Scheduling, slice 0: the four tables. Policies are 0097.
--
-- HAND-REORDERED AFTER GENERATION, and it has to stay that way. drizzle-kit
-- emits every ALTER TABLE ... ADD CONSTRAINT before every CREATE INDEX, which
-- is fine for FKs onto a primary key and fatal for the composite ones here:
-- `schedule_items(tenant_id, calendar_id) -> schedule_calendars(tenant_id, id)`
-- needs a unique index on the referenced pair to already exist, and generated
-- order created it forty lines later. Postgres refuses with 42830, "there is no
-- unique constraint matching given keys for referenced table".
--
-- So the two unique indexes that FKs point AT are created up front, before the
-- constraint block. If this migration is ever regenerated, redo that move.

CREATE TYPE "public"."schedule_access" AS ENUM('busy', 'titles', 'details', 'write');--> statement-breakpoint
CREATE TYPE "public"."schedule_response" AS ENUM('needs_action', 'accepted', 'declined', 'tentative');--> statement-breakpoint
CREATE TYPE "public"."schedule_sensitivity" AS ENUM('normal', 'private');--> statement-breakpoint
CREATE TYPE "public"."schedule_show_as" AS ENUM('free', 'busy', 'tentative', 'away');--> statement-breakpoint
CREATE TABLE "schedule_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_clerk_user_id" text,
	"name" text NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"extension_slug" text,
	"extension_key" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_calendars_primary_has_owner" CHECK (not "schedule_calendars"."is_primary" or "schedule_calendars"."owner_clerk_user_id" is not null),
	CONSTRAINT "schedule_calendars_extension_pair" CHECK (("schedule_calendars"."extension_slug" is null) = ("schedule_calendars"."extension_key" is null)),
	CONSTRAINT "schedule_calendars_extension_slug_format" CHECK ("schedule_calendars"."extension_slug" is null or "schedule_calendars"."extension_slug" ~ '^[a-z][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "schedule_item_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"clerk_user_id" text,
	"external_email" text,
	"external_name" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"response" "schedule_response" DEFAULT 'needs_action' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_attendees_exactly_one_identity" CHECK (num_nonnulls("schedule_item_attendees"."clerk_user_id", "schedule_item_attendees"."external_email") = 1)
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"time_zone" text NOT NULL,
	"show_as" "schedule_show_as" DEFAULT 'busy' NOT NULL,
	"sensitivity" "schedule_sensitivity" DEFAULT 'normal' NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_id" uuid,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_items_ends_after_starts" CHECK ("schedule_items"."ends_at" >= "schedule_items"."starts_at"),
	CONSTRAINT "schedule_items_no_self_parent" CHECK ("schedule_items"."parent_id" is distinct from "schedule_items"."id")
);
--> statement-breakpoint
CREATE TABLE "schedule_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"grantee_clerk_user_id" text NOT NULL,
	"access" "schedule_access" NOT NULL,
	"granted_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The two referenced pairs, created BEFORE the constraint block. See header.
CREATE UNIQUE INDEX "schedule_calendars_tenant_id_id_idx" ON "schedule_calendars" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_items_tenant_id_id_idx" ON "schedule_items" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "schedule_calendars" ADD CONSTRAINT "schedule_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_attendees" ADD CONSTRAINT "schedule_item_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_attendees" ADD CONSTRAINT "schedule_item_attendees_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."schedule_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_calendar_fk" FOREIGN KEY ("tenant_id","calendar_id") REFERENCES "public"."schedule_calendars"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."schedule_items"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_shares" ADD CONSTRAINT "schedule_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_shares" ADD CONSTRAINT "schedule_shares_calendar_fk" FOREIGN KEY ("tenant_id","calendar_id") REFERENCES "public"."schedule_calendars"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_calendars_primary_idx" ON "schedule_calendars" USING btree ("tenant_id","owner_clerk_user_id") WHERE "schedule_calendars"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_calendars_managed_idx" ON "schedule_calendars" USING btree ("tenant_id","extension_slug","extension_key") WHERE "schedule_calendars"."extension_slug" is not null;--> statement-breakpoint
CREATE INDEX "schedule_calendars_owner_idx" ON "schedule_calendars" USING btree ("tenant_id","owner_clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_attendees_internal_idx" ON "schedule_item_attendees" USING btree ("tenant_id","item_id","clerk_user_id") WHERE "schedule_item_attendees"."clerk_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_attendees_external_idx" ON "schedule_item_attendees" USING btree ("tenant_id","item_id","external_email") WHERE "schedule_item_attendees"."external_email" is not null;--> statement-breakpoint
CREATE INDEX "schedule_item_attendees_user_idx" ON "schedule_item_attendees" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "schedule_items_range_idx" ON "schedule_items" USING btree ("tenant_id","calendar_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_shares_unique_idx" ON "schedule_shares" USING btree ("tenant_id","calendar_id","grantee_clerk_user_id");--> statement-breakpoint
CREATE INDEX "schedule_shares_grantee_idx" ON "schedule_shares" USING btree ("tenant_id","grantee_clerk_user_id");
