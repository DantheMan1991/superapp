CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"nav_order" integer DEFAULT 0 NOT NULL,
	"in_nav" boolean DEFAULT true NOT NULL,
	"draft" jsonb DEFAULT '{"description":"","sections":[]}'::jsonb NOT NULL,
	"published" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_pages_path_shape" CHECK ("site_pages"."path" ~ '^/(?:[a-z0-9-]+(?:/[a-z0-9-]+)*)?$'),
	CONSTRAINT "site_pages_title_length" CHECK (length("site_pages"."title") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"copy_source" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_shape" CHECK ("sites"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
	CONSTRAINT "sites_status_values" CHECK ("sites"."status" in ('draft', 'published')),
	CONSTRAINT "sites_copy_source_values" CHECK ("sites"."copy_source" in ('model', 'standard')),
	CONSTRAINT "sites_title_length" CHECK (length("sites"."title") <= 80)
);
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Hand-reordered: the composite FK below needs this unique index to exist first,
-- and drizzle-kit emits every FK before every index (see src/db/schema/ledger.ts).
CREATE UNIQUE INDEX "sites_tenant_id_id_idx" ON "sites" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_tenant_id_id_idx" ON "site_pages" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "site_pages_tenant_idx" ON "site_pages" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_site_path_idx" ON "site_pages" USING btree ("site_id","path");
--> statement-breakpoint
CREATE UNIQUE INDEX "sites_tenant_idx" ON "sites" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sites_slug_idx" ON "sites" USING btree ("slug");
