-- assets: the first pack-owned table (Layer 2a, P4).
--
-- HAND-REORDERED FROM THE GENERATED OUTPUT, and the reason is worth keeping.
-- `assets_parent_fk` is SELF-REFERENTIAL — (tenant_id, parent_id) points back
-- at (tenant_id, id) on this same table — and Postgres will only accept a
-- foreign key whose referenced columns are already covered by a unique
-- constraint or index. drizzle-kit emitted the ALTER TABLE ... ADD CONSTRAINT
-- before the CREATE UNIQUE INDEX, which fails with:
--
--   there is no unique constraint matching given keys for referenced table "assets"
--
-- For every other composite FK in this schema the target lives in a different
-- table that was created earlier, so the ordering happened to work. It cannot
-- here. The index is therefore created first, and any future self-referencing
-- table in this codebase needs the same edit.

CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"identifier" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"acquired_on" date,
	"acquisition_cost_cents" bigint,
	"disposed_on" date,
	"parent_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_status_valid" CHECK ("assets"."status" in ('active', 'disposed')),
	CONSTRAINT "assets_kind_format" CHECK ("assets"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "assets_name_present" CHECK (length(btrim("assets"."name")) > 0),
	CONSTRAINT "assets_cost_nonnegative" CHECK ("assets"."acquisition_cost_cents" is null or "assets"."acquisition_cost_cents" >= 0),
	CONSTRAINT "assets_parent_not_self" CHECK ("assets"."parent_id" is null or "assets"."parent_id" <> "assets"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tenant_id_id_idx" ON "assets" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_tenant_kind_idx" ON "assets" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "assets_tenant_status_idx" ON "assets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "assets_tenant_parent_idx" ON "assets" USING btree ("tenant_id","parent_id");
