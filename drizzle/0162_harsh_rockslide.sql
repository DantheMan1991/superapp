-- Livestock slice 2 — the shared-feeder allocation seam.
--
-- HAND-REORDERED, SIXTH TIME. drizzle-kit emits every foreign key before every
-- index, and two of the FKs here point at `livestock_feed_groups (tenant_id,
-- id)` — a table created in this same migration, whose unique index is what
-- makes those columns referenceable at all. As generated, Postgres refuses both
-- with "there is no unique constraint matching given keys".
--
-- The rule is *check whether the FK's target is created in the same migration*,
-- not *always reorder*: `livestock_feed_group_members_lot_fk` and
-- `livestock_feed_draws_movement_fk` point at `livestock_lots` and
-- `inventory_movements`, which already exist, and would have been fine either
-- way. Only `livestock_feed_groups_tenant_id_id_idx` has moved.

CREATE TABLE "livestock_feed_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feed_group_id" uuid NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "livestock_feed_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feed_group_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_feed_group_members_range_ordered" CHECK ("livestock_feed_group_members"."ended_on" is null or "livestock_feed_group_members"."ended_on" >= "livestock_feed_group_members"."started_on")
);
--> statement-breakpoint
CREATE TABLE "livestock_feed_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_feed_groups_status_valid" CHECK ("livestock_feed_groups"."status" in ('active', 'closed')),
	CONSTRAINT "livestock_feed_groups_name_present" CHECK (length(btrim("livestock_feed_groups"."name")) > 0)
);
--> statement-breakpoint
-- MOVED UP from the bottom of the generated file: the two composite FKs below
-- reference these columns, and a foreign key needs a unique index on its target.
CREATE UNIQUE INDEX "livestock_feed_groups_tenant_id_id_idx" ON "livestock_feed_groups" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "livestock_feed_draws" ADD CONSTRAINT "livestock_feed_draws_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_draws" ADD CONSTRAINT "livestock_feed_draws_group_fk" FOREIGN KEY ("tenant_id","feed_group_id") REFERENCES "public"."livestock_feed_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_draws" ADD CONSTRAINT "livestock_feed_draws_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_group_members" ADD CONSTRAINT "livestock_feed_group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_group_members" ADD CONSTRAINT "livestock_feed_group_members_group_fk" FOREIGN KEY ("tenant_id","feed_group_id") REFERENCES "public"."livestock_feed_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_group_members" ADD CONSTRAINT "livestock_feed_group_members_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_feed_groups" ADD CONSTRAINT "livestock_feed_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_feed_draws_tenant_id_id_idx" ON "livestock_feed_draws" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_feed_draws_tenant_movement_idx" ON "livestock_feed_draws" USING btree ("tenant_id","inventory_movement_id");--> statement-breakpoint
CREATE INDEX "livestock_feed_draws_tenant_group_idx" ON "livestock_feed_draws" USING btree ("tenant_id","feed_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_feed_group_members_tenant_id_id_idx" ON "livestock_feed_group_members" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_feed_group_members_tenant_group_idx" ON "livestock_feed_group_members" USING btree ("tenant_id","feed_group_id");--> statement-breakpoint
CREATE INDEX "livestock_feed_group_members_tenant_lot_idx" ON "livestock_feed_group_members" USING btree ("tenant_id","livestock_lot_id");--> statement-breakpoint
CREATE INDEX "livestock_feed_groups_tenant_status_idx" ON "livestock_feed_groups" USING btree ("tenant_id","status");
