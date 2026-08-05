CREATE TABLE "crm_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text DEFAULT 'party' NOT NULL,
	"name" text NOT NULL,
	"owner_clerk_user_id" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"filter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_view_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"entity_type" text DEFAULT 'party' NOT NULL,
	"view_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_view_pins" ADD CONSTRAINT "crm_view_pins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_saved_views_tenant_id_id_idx" ON "crm_saved_views" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "crm_saved_views_tenant_entity_idx" ON "crm_saved_views" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_saved_views_name_idx" ON "crm_saved_views" USING btree ("tenant_id","entity_type","owner_clerk_user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_view_pins_unique_idx" ON "crm_view_pins" USING btree ("tenant_id","clerk_user_id","entity_type");