CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid,
	"display_name" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"primary_color" text DEFAULT '' NOT NULL,
	"accent_color" text DEFAULT '' NOT NULL,
	"logo_pathname" text,
	"logo_mime_type" text DEFAULT '' NOT NULL,
	"logo_width" integer DEFAULT 0 NOT NULL,
	"logo_height" integer DEFAULT 0 NOT NULL,
	"logo_bytes" integer DEFAULT 0 NOT NULL,
	"updated_by_clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_primary_color_shape" CHECK ("brand_kits"."primary_color" = '' or "brand_kits"."primary_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "brand_kits_accent_color_shape" CHECK ("brand_kits"."accent_color" = '' or "brand_kits"."accent_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "brand_kits_logo_whole" CHECK (("brand_kits"."logo_pathname" is null and "brand_kits"."logo_mime_type" = '' and "brand_kits"."logo_width" = 0 and "brand_kits"."logo_height" = 0 and "brand_kits"."logo_bytes" = 0)
        or ("brand_kits"."logo_pathname" is not null and "brand_kits"."logo_mime_type" <> '' and "brand_kits"."logo_width" > 0 and "brand_kits"."logo_height" > 0 and "brand_kits"."logo_bytes" > 0)),
	CONSTRAINT "brand_kits_display_name_length" CHECK (length("brand_kits"."display_name") <= 80),
	CONSTRAINT "brand_kits_tagline_length" CHECK (length("brand_kits"."tagline") <= 140)
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_tenant_id_id_idx" ON "brand_kits" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "brand_kits_tenant_idx" ON "brand_kits" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_tenant_business_idx" ON "brand_kits" USING btree ("tenant_id") WHERE "brand_kits"."entity_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_tenant_entity_idx" ON "brand_kits" USING btree ("tenant_id","entity_id") WHERE "brand_kits"."entity_id" is not null;