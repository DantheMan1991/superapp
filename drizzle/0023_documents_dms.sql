CREATE TABLE "document_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"effective_visibility" text DEFAULT 'members' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_folders_no_self_parent" CHECK ("document_folders"."parent_id" is null or "document_folders"."parent_id" <> "document_folders"."id"),
	CONSTRAINT "document_folders_visibility" CHECK ("document_folders"."visibility" in ('members', 'owners')),
	CONSTRAINT "document_folders_eff_visibility" CHECK ("document_folders"."effective_visibility" in ('members', 'owners')),
	CONSTRAINT "document_folders_eff_implies" CHECK ("document_folders"."visibility" <> 'owners' or "document_folders"."effective_visibility" = 'owners'),
	CONSTRAINT "document_folders_depth" CHECK ("document_folders"."depth" between 1 and 10),
	CONSTRAINT "document_folders_name_not_blank" CHECK (length(btrim("document_folders"."name")) > 0),
	CONSTRAINT "document_folders_path_format" CHECK ("document_folders"."path" ~ '^(/[0-9a-f]{32})+/$')
);
--> statement-breakpoint
CREATE TABLE "document_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_saved_views_scope" CHECK ("document_saved_views"."scope" in ('tenant', 'private')),
	CONSTRAINT "document_saved_views_name_not_blank" CHECK (length(btrim("document_saved_views"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "document_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sharing_enabled" boolean DEFAULT true NOT NULL,
	"share_max_ttl_days" integer DEFAULT 30 NOT NULL,
	"esign_enabled" boolean DEFAULT false NOT NULL,
	"ai_last_template_at" timestamp with time zone,
	"ai_template_count_date" date,
	"ai_template_count_today" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_settings_ttl_positive" CHECK ("document_settings"."share_max_ttl_days" between 1 and 365),
	CONSTRAINT "document_settings_ai_count_nonneg" CHECK ("document_settings"."ai_template_count_today" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_tags_slug_format" CHECK ("document_tags"."slug" ~ '^[a-z0-9][a-z0-9-]{0,48}$'),
	CONSTRAINT "document_tags_name_not_blank" CHECK (length(btrim("document_tags"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"blob_pathname" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"restored_from_version_id" uuid,
	"uploaded_by_clerk_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_size_nonnegative" CHECK ("document_versions"."size_bytes" >= 0),
	CONSTRAINT "document_versions_no_positive" CHECK ("document_versions"."version_no" >= 1)
);
--> statement-breakpoint
-- Hand edit: `origin` is NOT NULL with no default in schema.ts (so Drizzle's
-- $inferInsert makes it REQUIRED and every insert site must declare which
-- surface it belongs to), but the column has to be born with a default or this
-- ALTER fails against existing receipt rows. Add it defaulted, backfill for
-- free, then drop the default so the type-level requirement is real.
ALTER TABLE "documents" ADD COLUMN "origin" text DEFAULT 'accounting' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "origin" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "doc_kind" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "effective_visibility" text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_version_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_version_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extracted_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "filed_at" timestamp with time zone;--> statement-breakpoint
-- Moved up (hand edit): the composite parent key must exist before
-- document_folders_parent_fk and documents_folder_fk reference it in this same
-- migration. Same trap as drizzle/0013_documents.sql.
CREATE UNIQUE INDEX "document_folders_tenant_id_id_idx" ON "document_folders" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."document_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_saved_views" ADD CONSTRAINT "document_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_settings" ADD CONSTRAINT "document_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_tenant_parent_name_idx" ON "document_folders" USING btree ("tenant_id","parent_id","name_key") WHERE "document_folders"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_tenant_root_name_idx" ON "document_folders" USING btree ("tenant_id","name_key") WHERE "document_folders"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "document_folders_tenant_parent_idx" ON "document_folders" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_saved_views_tenant_id_id_idx" ON "document_saved_views" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_saved_views_tenant_owner_name_idx" ON "document_saved_views" USING btree ("tenant_id","created_by_clerk_user_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_settings_tenant_id_id_idx" ON "document_settings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_settings_tenant_idx" ON "document_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_tags_tenant_id_id_idx" ON "document_tags" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_tags_tenant_slug_idx" ON "document_tags" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_tenant_id_id_idx" ON "document_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_no_idx" ON "document_versions" USING btree ("tenant_id","document_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_current_idx" ON "document_versions" USING btree ("tenant_id","document_id") WHERE "document_versions"."is_current";--> statement-breakpoint
CREATE INDEX "document_versions_tenant_doc_idx" ON "document_versions" USING btree ("tenant_id","document_id","version_no");--> statement-breakpoint
CREATE INDEX "document_versions_blob_idx" ON "document_versions" USING btree ("blob_pathname");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."document_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_tenant_origin_idx" ON "documents" USING btree ("tenant_id","origin","status","created_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_folder_idx" ON "documents" USING btree ("tenant_id","folder_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_tags_gin_idx" ON "documents" USING gin ("tags");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_origin_check" CHECK ("documents"."origin" in ('accounting', 'dms'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_visibility_check" CHECK ("documents"."effective_visibility" in ('members', 'owners'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_version_check" CHECK ("documents"."file_version_no" >= 1 and "documents"."file_version_count" >= "documents"."file_version_no");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tags_cap" CHECK (array_length("documents"."tags", 1) is null or array_length("documents"."tags", 1) <= 30);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_filed_at_requires_folder" CHECK ("documents"."folder_id" is not null or "documents"."filed_at" is null);