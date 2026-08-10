-- Work, slice 3: links and saved views. RLS is the next migration.
--
-- NOT hand-reordered, and checked rather than assumed. 0104's header warns that
-- drizzle-kit emits every ADD CONSTRAINT before every CREATE INDEX; that only
-- breaks when the referenced unique index is created in the SAME file. Here
-- `work_item_links_item_fk` points at `work_items_tenant_id_id_idx`, which 0104
-- already created, so the generated order runs as-is.

CREATE TABLE "work_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"extension_slug" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_links_entity_type_format" CHECK ("work_item_links"."entity_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "work_item_links_extension_slug_format" CHECK ("work_item_links"."extension_slug" ~ '^[a-z][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "work_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"params" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_saved_views_scope" CHECK ("work_saved_views"."scope" in ('tenant', 'private')),
	CONSTRAINT "work_saved_views_name_not_blank" CHECK (length(btrim("work_saved_views"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_saved_views" ADD CONSTRAINT "work_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_links_tenant_id_id_idx" ON "work_item_links" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_links_unique_idx" ON "work_item_links" USING btree ("tenant_id","item_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "work_item_links_entity_idx" ON "work_item_links" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_saved_views_tenant_id_id_idx" ON "work_saved_views" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_saved_views_owner_name_idx" ON "work_saved_views" USING btree ("tenant_id","created_by_clerk_user_id","name_key");