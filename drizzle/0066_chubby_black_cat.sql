CREATE TYPE "public"."crm_field_type" AS ENUM('text', 'number', 'date', 'boolean', 'select', 'multi_select', 'url');--> statement-breakpoint
CREATE TABLE "crm_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text DEFAULT 'party' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" "crm_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_field_defs_key_format" CHECK ("crm_field_defs"."key" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "crm_field_defs" ADD CONSTRAINT "crm_field_defs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_field_defs_tenant_id_id_idx" ON "crm_field_defs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_field_defs_tenant_key_idx" ON "crm_field_defs" USING btree ("tenant_id","entity_type","key") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "crm_field_defs_tenant_entity_idx" ON "crm_field_defs" USING btree ("tenant_id","entity_type","sort_order");