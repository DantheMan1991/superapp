-- site_page_versions: RLS. ENABLE + FORCE. Members read; OWNERS write;
-- superadmin all — the posture of sites and site_pages (0247), because a
-- page's history is the page's: whoever may change the draft may leave and
-- restore a version, and everyone in the workspace may see what changed.
--
-- The composite FK (tenant_id, page_id) → site_pages is in 0248, so a version
-- cannot name another tenant's page even under withSystem; the page's own FK
-- carries the cascade down from the site. No public policy: the public
-- renderer never reads history. tests/isolation/sites.test.ts asserts each
-- clause here.

ALTER TABLE "site_page_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_page_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_page_versions_superadmin_all ON "site_page_versions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_page_versions_member_read ON "site_page_versions" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_page_versions_owner_insert ON "site_page_versions" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_page_versions_owner_delete ON "site_page_versions" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
