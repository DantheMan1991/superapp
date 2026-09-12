CREATE TABLE "site_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_clerk_user_id" text,
	"created_by_clerk_user_id" text NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_previews_label_length" CHECK (length("site_previews"."label") <= 80)
);
--> statement-breakpoint
ALTER TABLE "site_previews" ADD CONSTRAINT "site_previews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_previews" ADD CONSTRAINT "site_previews_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_previews_tenant_id_id_idx" ON "site_previews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_previews_tenant_idx" ON "site_previews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_previews_site_idx" ON "site_previews" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_previews_token_idx" ON "site_previews" USING btree ("token_hash");