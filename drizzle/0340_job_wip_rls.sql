-- job_wip_periods, job_wip_lines: RLS. Pattern per drizzle/0338_job_field_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all, on both.
--
-- MEMBER-WIDE at the row level, owner-only at the VERB: the pack's own write
-- level says `owner` for an estimate and for posting, because recognising
-- revenue on a percent complete somebody estimated is a decision (ADR 0059).
-- The rows themselves are visible to every member, the same rule the whole
-- project follows (0326_jobs_rls.sql says why).
--
-- The entries a period points at are the ledger's rows under the ledger's
-- policies; `wip_adjustment` is a MANAGED source, so the journal refuses to
-- void them and only the pack's unpost does.

ALTER TABLE "job_wip_periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_wip_periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_wip_periods_superadmin_all ON "job_wip_periods"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_wip_periods_member_all ON "job_wip_periods"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_wip_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_wip_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_wip_lines_superadmin_all ON "job_wip_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_wip_lines_member_all ON "job_wip_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
