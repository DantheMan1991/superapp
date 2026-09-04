-- sites + site_pages: RLS. ENABLE + FORCE. Members read; OWNERS write;
-- superadmin all. The same posture as brand_kits (0244): the site is how the
-- business looks to the world, so whoever owns the business decides it, and
-- everyone in the workspace may see it.
--
-- WHAT IS NOT HERE, DELIBERATELY: a public policy. Strangers read a published
-- site through ONE trusted lookup — slug → tenant, identifiers only, under
-- withSystem in src/lib/sites/read.ts — and then through these member
-- policies inside that tenant's context as `staff`. "No context → no rows"
-- still holds at the database; the renderer never opens a hole to get its
-- rows, it opens a tenant.
--
-- The composite FK (tenant_id, site_id) → sites is in 0246, hand-reordered so
-- the referenced unique index exists first. tests/isolation/sites.test.ts
-- asserts every clause here plus the cross-tenant slug uniqueness.

ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sites_superadmin_all ON "sites"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY sites_member_read ON "sites" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY sites_owner_insert ON "sites" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY sites_owner_update ON "sites" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY sites_owner_delete ON "sites" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint

ALTER TABLE "site_pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_pages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_pages_superadmin_all ON "site_pages"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_pages_member_read ON "site_pages" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_pages_owner_insert ON "site_pages" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_pages_owner_update ON "site_pages" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_pages_owner_delete ON "site_pages" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
