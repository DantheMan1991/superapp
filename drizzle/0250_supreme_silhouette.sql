CREATE TABLE "site_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"apex" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vercel_verified" boolean DEFAULT false NOT NULL,
	"vercel_configured_by" text DEFAULT '' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_domains_domain_shape" CHECK ("site_domains"."domain" ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
	CONSTRAINT "site_domains_status_values" CHECK ("site_domains"."status" in ('pending', 'active', 'error'))
);
--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_tenant_id_id_idx" ON "site_domains" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_domains_tenant_idx" ON "site_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_domains_site_idx" ON "site_domains" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_domain_idx" ON "site_domains" USING btree ("domain");