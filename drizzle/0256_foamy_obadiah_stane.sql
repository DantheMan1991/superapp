CREATE TABLE "site_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pathname" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_images_mime_values" CHECK ("site_images"."mime_type" in ('image/jpeg', 'image/png')),
	CONSTRAINT "site_images_dimensions" CHECK ("site_images"."width" > 0 and "site_images"."height" > 0 and "site_images"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "site_images" ADD CONSTRAINT "site_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_images" ADD CONSTRAINT "site_images_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_images_tenant_id_id_idx" ON "site_images" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_images_site_idx" ON "site_images" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_images_pathname_idx" ON "site_images" USING btree ("pathname");