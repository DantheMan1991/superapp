-- ps_engagements + ps_engagement_allotments + ps_time_entries: RLS. Pattern per
-- drizzle/0126_assets_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Agreeing an engagement and changing its terms are `owner` verbs
-- there (a decision with a money consequence, and `upsertDimensionMember`
-- requires an owner anyway); logging an hour is a `member` chore done by
-- whoever did the work. See src/lib/packs/authorize.ts.
--
-- WHAT A COLLEAGUE MAY SEE IS THE WHOLE ENGAGEMENT, on purpose. Somebody
-- logging their afternoon has to find the engagement to log it against, and
-- the retainer they are eating into is the thing that makes the entry worth
-- making. Rates and fees ride along; a business that wanted those hidden would
-- need a visibility model, which is a bigger question than this pack and one
-- nobody has asked. FORCEd for the reason every table here is: the app
-- connects as `app_user`, and the policy is the backstop, not the app code.

ALTER TABLE "ps_engagements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ps_engagements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ps_engagements_superadmin_all ON "ps_engagements"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY ps_engagements_member_all ON "ps_engagements"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ps_engagement_allotments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ps_engagement_allotments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ps_engagement_allotments_superadmin_all ON "ps_engagement_allotments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY ps_engagement_allotments_member_all ON "ps_engagement_allotments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ps_time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ps_time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ps_time_entries_superadmin_all ON "ps_time_entries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY ps_time_entries_member_all ON "ps_time_entries"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
