CREATE TABLE "site_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"page_path" text DEFAULT '/' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"party_id" uuid,
	"work_item_id" uuid,
	"notify_via" text DEFAULT 'none' NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_enquiries_name_len" CHECK (char_length("site_enquiries"."name") between 1 and 120),
	CONSTRAINT "site_enquiries_message_len" CHECK (char_length("site_enquiries"."message") between 1 and 4000),
	CONSTRAINT "site_enquiries_notify_values" CHECK ("site_enquiries"."notify_via" in ('none', 'site_email', 'owners'))
);
--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_enquiries_tenant_id_id_idx" ON "site_enquiries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_enquiries_tenant_idx" ON "site_enquiries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_enquiries_site_idx" ON "site_enquiries" USING btree ("site_id","created_at");