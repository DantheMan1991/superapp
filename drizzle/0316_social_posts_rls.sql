-- social_posts: RLS. ENABLE + FORCE. Members read; OWNERS insert, update and
-- delete; superadmin all — the posture of `social_channels` (0307), `sites`
-- (0247) and `site_images` (0257). Marketing slice S1.
--
-- OWNER-ONLY TO WRITE, AND IT MATTERS MORE HERE THAN FOR A LOGO. What this
-- table holds is the business's public voice. In this build a person still has
-- to go and post it, but S6 brings connections that send a scheduled post on
-- its own — so whoever may write a row may eventually publish one. That is a
-- decision to take deliberately, with a reason written down, rather than a
-- default to drift into by copying a more permissive table.
--
-- WHICH IS WHY THE TEN-MINUTE SWEEP WRITES UNDER `withSystem`. It stamps
-- `reminded_at` and `work_item_id` after raising the work item, and it is not
-- a person: trusted background code, no caller input, picking its own work —
-- the case AGENTS.md names. The alternative was a member UPDATE policy so the
-- cron could write as `staff`, and RLS is row-level, not column-level, so that
-- would have let any member rewrite any post. See
-- `src/modules/marketing/post-reminders.ts`.
--
-- The work item ITSELF is raised as `staff` inside the tenant, exactly as the
-- website's enquiry form raises one (ADR 0021); Work's own policies decide.
--
-- No public policy: a post is not published by this build and nothing outside
-- the workspace reads this table. The composite FKs -- (tenant_id, channel_id)
-- CASCADE, (tenant_id, image_id) SET NULL on the photo column only -- are in
-- the generated migration beside this one.
-- tests/isolation/social.test.ts asserts each clause here.

ALTER TABLE "social_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "social_posts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY social_posts_superadmin_all ON "social_posts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY social_posts_member_read ON "social_posts" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY social_posts_owner_insert ON "social_posts" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY social_posts_owner_update ON "social_posts" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY social_posts_owner_delete ON "social_posts" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
