-- job_selections, job_selection_choices: RLS. Pattern per
-- drizzle/0351_lien_waivers_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all, on both.
--
-- MEMBER-WIDE at the row level and at the verb: drawing up the selection
-- list, listing what the showroom sent back and recording what the client
-- chose is the office's chore (the designer is rarely the owner), as the
-- daily log is. The one decision — raising the difference as a change
-- order on a signed contract — goes through the change order's own owner
-- verb. The samples and spec sheets are Documents attachments under
-- Documents' own policy.

ALTER TABLE "job_selections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_selections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_selections_superadmin_all ON "job_selections"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_selections_member_all ON "job_selections"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_selection_choices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_selection_choices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_selection_choices_superadmin_all ON "job_selection_choices"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_selection_choices_member_all ON "job_selection_choices"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
