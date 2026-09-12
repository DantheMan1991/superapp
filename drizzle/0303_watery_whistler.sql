-- site_previews: RLS. ENABLE + FORCE. Members read; OWNERS insert and update;
-- nobody deletes; superadmin all. Marketing slice 20, ADR 0046.
--
-- The posture is `site_images`' (0247) with two deliberate differences.
--
-- OWNERS UPDATE, and it is how a link is revoked and how a view is counted.
-- Revoking sets `revoked_at` rather than deleting the row, so a link that was
-- given out stays answerable — "who made this, when, was it used" survives the
-- revocation, which is the whole reason an audit trail exists. That is also
-- why there is NO DELETE POLICY AT ALL: a preview link is a thing that was
-- handed to somebody outside the business, and the record of it is not the
-- owner's to erase. It dies only with its site, through the composite FK.
--
-- THE PUBLIC ROUTE NEVER READS THIS TABLE UNDER A MEMBER CONTEXT. The token →
-- tenant hop runs under `withSystem`, exactly as the document share's does
-- (src/modules/documents/shares/resolve.ts) and for the same reason: there is
-- no session to scope by, so the ONE lookup that widens is kept to a single
-- token-hash equality and everything after it runs under `withTenant` as
-- `staff`. The view counter is written in that same system hop because a
-- stranger has no role to write with; it touches only the row the token
-- matched. Widening that lookup is the dangerous refactor.
--
-- tests/isolation/sites.test.ts asserts each clause here.

ALTER TABLE "site_previews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_previews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_previews_superadmin_all ON "site_previews"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_previews_member_read ON "site_previews" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_previews_owner_insert ON "site_previews" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY site_previews_owner_update ON "site_previews" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK ("tenant_id" = app_current_tenant());
