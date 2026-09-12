-- social_channels: RLS. ENABLE + FORCE. Members read; OWNERS insert, update
-- and delete; superadmin all — the posture of `sites` (0247) and
-- `site_images` (0257): how the business looks to its customers, and now
-- WHERE it speaks to them, is the owner's decision, and everyone in the
-- workspace may see it. Marketing slice S0, ADR 0047.
--
-- UPDATE IS ALLOWED HERE, unlike site_images. A photo is never edited (a
-- replaced photo is a new row); a channel is edited all the time — a handle
-- changes, an account is paused, the voice is tuned after reading what the
-- writer produced from it. The row is the account, not a record of an event.
--
-- NO PUBLIC POLICY. Nothing outside the workspace reads this table: the marks
-- on a public page come from `sites.settings.social`, which is the whole point
-- of keeping a footer link and a channel apart. "No context → no rows" holds
-- at the database, with nothing carved out of it.
--
-- The composite FK (tenant_id, site_id) → sites, nullable on this side, is in
-- the generated migration beside this one; the unique index on
-- (tenant_id, network, handle) is what makes one account one row.
-- tests/isolation/social.test.ts asserts each clause here.

ALTER TABLE "social_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "social_channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY social_channels_superadmin_all ON "social_channels"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY social_channels_member_read ON "social_channels" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY social_channels_owner_insert ON "social_channels" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY social_channels_owner_update ON "social_channels" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY social_channels_owner_delete ON "social_channels" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
