CREATE TABLE "site_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" text DEFAULT 'save' NOT NULL,
	"content" jsonb NOT NULL,
	"created_by_clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_page_versions_kind_values" CHECK ("site_page_versions"."kind" in ('save', 'publish', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_page_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."site_pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_page_versions_tenant_id_id_idx" ON "site_page_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_page_versions_tenant_idx" ON "site_page_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_page_versions_page_idx" ON "site_page_versions" USING btree ("page_id","created_at");