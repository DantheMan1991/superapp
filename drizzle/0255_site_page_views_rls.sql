-- site_page_views: RLS. ENABLE + FORCE. Members read; members INSERT and
-- UPDATE (the beacon's upsert); nobody deletes; superadmin all. Marketing
-- slice 4b, ADR 0022.
--
-- THE WRITE IS THE PUBLIC BEACON'S. A browser on a published site posts one
-- view; src/lib/sites/views.ts turns the site's slug into a tenant through
-- the same trusted lookup the renderer uses, checks the path is a published
-- page, then adds one to two counters as `staff` inside that tenant — so the
-- member policies below are what the beacon satisfies. No DELETE policy: the
-- app never removes a row (pages × days is small) and a member cannot either.
-- The composite FK (tenant_id, site_id) → sites is in 0254; the unique index
-- on (site_id, day, path) is what makes the upsert one row per page per day.
-- tests/isolation/sites.test.ts asserts each clause here.

ALTER TABLE "site_page_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_page_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_page_views_superadmin_all ON "site_page_views"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_page_views_member_read ON "site_page_views" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_page_views_member_insert ON "site_page_views" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() IN ('owner', 'staff')
  );
--> statement-breakpoint
CREATE POLICY site_page_views_member_update ON "site_page_views" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() IN ('owner', 'staff')
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() IN ('owner', 'staff')
  );
