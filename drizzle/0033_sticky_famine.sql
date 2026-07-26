CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"doc_kind" text DEFAULT '' NOT NULL,
	"default_folder_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_name_not_blank" CHECK (length(btrim("document_templates"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_clerk_user_id" text,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_template_versions_no_positive" CHECK ("document_template_versions"."version_no" >= 1),
	CONSTRAINT "document_template_versions_published_pair" CHECK (("document_template_versions"."published_at" is null) = ("document_template_versions"."published_by_clerk_user_id" is null))
);
--> statement-breakpoint
-- HAND EDIT (see docs/modules/documents.md): this unique index must be created
-- BEFORE the composite FK that references it, or the migration fails with
-- "there is no unique constraint matching given keys". Drizzle emits indexes
-- after constraints; 0013 and 0023 hit the same trap.
CREATE UNIQUE INDEX "document_templates_tenant_id_id_idx" ON "document_templates" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_folder_fk" FOREIGN KEY ("tenant_id","default_folder_id") REFERENCES "public"."document_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."document_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_tenant_id_id_idx" ON "document_template_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_no_idx" ON "document_template_versions" USING btree ("tenant_id","template_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_draft_idx" ON "document_template_versions" USING btree ("tenant_id","template_id") WHERE "document_template_versions"."published_at" is null;--> statement-breakpoint
CREATE INDEX "document_template_versions_tenant_template_idx" ON "document_template_versions" USING btree ("tenant_id","template_id","version_no");--> statement-breakpoint
CREATE INDEX "document_templates_tenant_kind_idx" ON "document_templates" USING btree ("tenant_id","doc_kind");
