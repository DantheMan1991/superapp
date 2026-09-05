-- site_images: RLS. ENABLE + FORCE. Members read; OWNERS insert and delete;
-- nobody updates; superadmin all — the posture of sites (0247): what the
-- business's site shows is the owner's decision, and everyone in the
-- workspace may see it. Marketing slice 5, ADR 0023.
--
-- THE PUBLIC ROUTE READS THIS TABLE AS `staff` inside the tenant the slug
-- resolved to, for a PUBLISHED site only (src/lib/sites/images.ts); the
-- member route reads it under the caller's own context. No UPDATE policy:
-- a photo is never edited, a replaced photo is a new row. The composite FK
-- (tenant_id, site_id) → sites is in the generated migration beside this
-- one; the unique index on `pathname` is what makes one blob one row.
-- tests/isolation/sites.test.ts asserts each clause here.

ALTER TABLE "site_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_images" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_images_superadmin_all ON "site_images"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_images_member_read ON "site_images" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_images_owner_insert ON "site_images" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_images_owner_delete ON "site_images" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
