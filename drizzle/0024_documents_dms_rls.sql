-- Documents module (DMS): RLS for the five new tables, plus the one change to
-- an EXISTING policy this whole feature rests on.
--
-- Until now a policy could ask "which tenant?" but not "which role?". Folder
-- visibility needs the second question, so this migration adds a third
-- transaction-local setting, app.tenant_role, set by withTenant (src/db/index.ts).
--
-- It is fail-closed by construction: the function defaults to 'staff', the LEAST
-- privileged value, so every existing two-argument withTenant() call keeps
-- working AND is denied owners-only rows. A forgotten opt-in denies a read; it
-- can never grant one. Same discipline as gate({allowExpert}) in the accounting
-- actions.
--
-- Pattern otherwise per drizzle/0001_rls.sql: ENABLE + FORCE, superadmin_all,
-- member_all.

CREATE OR REPLACE FUNCTION app_current_tenant_role() RETURNS text AS $$
  SELECT coalesce(nullif(current_setting('app.tenant_role', true), ''), 'staff');
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- The prefix index for subtree queries (`path LIKE '/a/b/%'`). Hand-written
-- because drizzle-kit cannot emit opclasses, and text_pattern_ops is REQUIRED:
-- without it a LIKE-prefix match silently seq-scans on a non-C collation.
CREATE INDEX "document_folders_tenant_path_idx"
  ON "document_folders" ("tenant_id", "path" text_pattern_ops);
--> statement-breakpoint

-- Replace the member policy on `documents`. The visibility term is what stops a
-- staff member reading an owners-only file — including through the blob
-- streaming route, which is a bare id lookup and has no folder awareness of its
-- own. The WITH CHECK half additionally means staff cannot MOVE a document into
-- a restricted folder, which we get for free.
DROP POLICY documents_member_all ON "documents";
--> statement-breakpoint
CREATE POLICY documents_member_all ON "documents"
  USING (
    "tenant_id" = app_current_tenant()
    AND ("effective_visibility" = 'members' OR app_current_tenant_role() = 'owner')
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND ("effective_visibility" = 'members' OR app_current_tenant_role() = 'owner')
  );
--> statement-breakpoint

-- Folders carry the same term: folder NAMES leak the structure otherwise.
ALTER TABLE "document_folders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_folders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_folders_superadmin_all ON "document_folders"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_folders_member_all ON "document_folders"
  USING (
    "tenant_id" = app_current_tenant()
    AND ("effective_visibility" = 'members' OR app_current_tenant_role() = 'owner')
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND ("effective_visibility" = 'members' OR app_current_tenant_role() = 'owner')
  );
--> statement-breakpoint

-- Versions INHERIT visibility instead of storing a third copy of the flag:
-- RLS applies inside policy subqueries, so `documents`' own visibility term
-- filters this EXISTS automatically. No drift possible, and no cycle —
-- documents' policy does not reference document_versions.
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_versions_superadmin_all ON "document_versions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_versions_member_all ON "document_versions"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "documents" d
       WHERE d."tenant_id" = "document_versions"."tenant_id"
         AND d."id" = "document_versions"."document_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "documents" d
       WHERE d."tenant_id" = "document_versions"."tenant_id"
         AND d."id" = "document_versions"."document_id"
    )
  );
--> statement-breakpoint

-- Tags and saved views are not visibility-bearing: a tag name is not a
-- document, and hiding the registry from staff would break the filter UI
-- without hiding anything they could not already see.
ALTER TABLE "document_tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_tags_superadmin_all ON "document_tags"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_tags_member_all ON "document_tags"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "document_saved_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_saved_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_saved_views_superadmin_all ON "document_saved_views"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_saved_views_member_all ON "document_saved_views"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- Settings are platform-governed knobs (share TTL ceiling, AI budget): members
-- read them, only trusted server code writes them. member_read pattern per
-- drizzle/0020_retainers_rls.sql.
ALTER TABLE "document_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_settings_superadmin_all ON "document_settings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_settings_member_read ON "document_settings" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
