-- HAND-REORDERED, and this is the sixth time in this repo. The composite FK
-- `(tenant_id, livestock_group_id)` REFERENCES `livestock_groups(tenant_id, id)`
-- needs that unique index to EXIST when the constraint is added, and drizzle
-- emits every ADD CONSTRAINT ahead of every CREATE INDEX. So
-- `livestock_groups_tenant_id_id_idx` is moved above the FK that needs it.
--
-- The rule recorded at 0138 is *check whether the TARGET is new*, not *always
-- reorder*: `livestock_group_members_lot_fk` points at `livestock_lots`, which
-- has had its unique index since 0138, and needed no help. `livestock_groups` is
-- created here, so it did. The failure is loud — `there is no unique constraint
-- matching given keys for referenced table` — and the whole migration rolls
-- back, which is why this was found on the dev branch rather than in production.

CREATE TABLE "livestock_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_group_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_group_members_range_ordered" CHECK ("livestock_group_members"."ended_on" is null or "livestock_group_members"."ended_on" >= "livestock_group_members"."started_on")
);
--> statement-breakpoint
CREATE TABLE "livestock_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_groups_status_valid" CHECK ("livestock_groups"."status" in ('active', 'closed')),
	CONSTRAINT "livestock_groups_name_present" CHECK (length(btrim("livestock_groups"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "livestock_group_members" ADD CONSTRAINT "livestock_group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_groups_tenant_id_id_idx" ON "livestock_groups" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "livestock_group_members" ADD CONSTRAINT "livestock_group_members_group_fk" FOREIGN KEY ("tenant_id","livestock_group_id") REFERENCES "public"."livestock_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestock_group_members" ADD CONSTRAINT "livestock_group_members_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "livestock_groups" ADD CONSTRAINT "livestock_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_group_members_tenant_id_id_idx" ON "livestock_group_members" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "livestock_group_members_tenant_group_idx" ON "livestock_group_members" USING btree ("tenant_id","livestock_group_id");
--> statement-breakpoint
CREATE INDEX "livestock_group_members_tenant_lot_idx" ON "livestock_group_members" USING btree ("tenant_id","livestock_lot_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_group_members_one_open_idx" ON "livestock_group_members" USING btree ("tenant_id","livestock_lot_id") WHERE "livestock_group_members"."ended_on" is null;
--> statement-breakpoint
CREATE INDEX "livestock_groups_tenant_status_idx" ON "livestock_groups" USING btree ("tenant_id","status");
