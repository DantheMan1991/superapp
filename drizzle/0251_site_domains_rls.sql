-- site_domains: RLS. ENABLE + FORCE. Members read; OWNERS write; superadmin
-- all — the posture of sites (0247): which hostnames reach the business's
-- site is the owner's decision, and everyone in the workspace may see it.
--
-- THE PUBLIC RENDERER READS THIS TABLE ONCE PER HOSTNAME, UNDER withSystem,
-- and returns identifiers only (src/lib/sites/read.ts, lookupSiteByDomain) —
-- the same trusted-lookup shape as the slug. Only an `active` row routes;
-- a pending domain answers 404 like a domain nobody connected. No public
-- policy. The composite FK (tenant_id, site_id) → sites is in 0250; the
-- unique index on `domain` is what makes one hostname point at one site.
-- tests/isolation/sites.test.ts asserts each clause here.

ALTER TABLE "site_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_domains" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_domains_superadmin_all ON "site_domains"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_domains_member_read ON "site_domains" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_domains_owner_insert ON "site_domains" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_domains_owner_update ON "site_domains" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_domains_owner_delete ON "site_domains" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
