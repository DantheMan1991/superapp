-- job_sheet_markups: RLS. Pattern per drizzle/0362_job_drawings_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level and at the verb: a markup is drawn by whoever
-- is on the site with the sheet open, and the punch item a pin raises is an
-- ordinary Work item under Work's own policy (ADR 0073).

ALTER TABLE "job_sheet_markups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_sheet_markups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_sheet_markups_superadmin_all ON "job_sheet_markups"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_sheet_markups_member_all ON "job_sheet_markups"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
