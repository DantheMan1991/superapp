CREATE TABLE "social_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid,
	"network" text NOT NULL,
	"handle" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"profile_url" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_channels_network_values" CHECK ("social_channels"."network" in ('facebook', 'instagram', 'youtube', 'tiktok', 'linkedin', 'x', 'pinterest', 'other')),
	CONSTRAINT "social_channels_status_values" CHECK ("social_channels"."status" in ('active', 'paused')),
	CONSTRAINT "social_channels_handle_length" CHECK (length("social_channels"."handle") between 1 and 80),
	CONSTRAINT "social_channels_label_length" CHECK (length("social_channels"."label") <= 80),
	CONSTRAINT "social_channels_url_length" CHECK (length("social_channels"."profile_url") <= 500),
	CONSTRAINT "social_channels_audience_length" CHECK (length("social_channels"."audience") <= 400),
	CONSTRAINT "social_channels_voice_length" CHECK (length("social_channels"."voice") <= 400),
	CONSTRAINT "social_channels_other_has_label" CHECK ("social_channels"."network" <> 'other' or length(btrim("social_channels"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_channels_tenant_id_id_idx" ON "social_channels" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "social_channels_owner_idx" ON "social_channels" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_channels_account_idx" ON "social_channels" USING btree ("tenant_id","network","handle");