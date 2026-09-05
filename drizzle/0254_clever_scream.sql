CREATE TABLE "site_page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"day" date NOT NULL,
	"path" text DEFAULT '/' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_page_views_counts" CHECK ("site_page_views"."views" >= 0 and "site_page_views"."visitors" >= 0)
);
--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_page_views" ADD CONSTRAINT "site_page_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_views" ADD CONSTRAINT "site_page_views_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_page_views_site_day_path_idx" ON "site_page_views" USING btree ("site_id","day","path");--> statement-breakpoint
CREATE INDEX "site_page_views_tenant_idx" ON "site_page_views" USING btree ("tenant_id");