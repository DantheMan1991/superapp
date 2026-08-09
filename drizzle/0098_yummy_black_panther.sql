CREATE TABLE "schedule_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"extension_slug" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_links_entity_type_format" CHECK ("schedule_item_links"."entity_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "schedule_item_links_extension_slug_format" CHECK ("schedule_item_links"."extension_slug" ~ '^[a-z][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "schedule_item_links" ADD CONSTRAINT "schedule_item_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_links" ADD CONSTRAINT "schedule_item_links_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."schedule_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_links_tenant_id_id_idx" ON "schedule_item_links" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_links_unique_idx" ON "schedule_item_links" USING btree ("tenant_id","item_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "schedule_item_links_entity_idx" ON "schedule_item_links" USING btree ("tenant_id","entity_type","entity_id");