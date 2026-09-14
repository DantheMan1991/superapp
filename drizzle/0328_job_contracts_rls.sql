-- job_contracts: RLS. Pattern per drizzle/0326_jobs_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Agreeing a contract and changing its value are `owner` verbs there,
-- because a contract value is the number every report about a job is measured
-- against. See src/lib/packs/authorize.ts.
--
-- WHAT A COLLEAGUE MAY SEE IS THE CONTRACT VALUE, and this is the sharpest
-- version of the caution `0326_jobs_rls.sql` already carries for the project
-- itself. A job's contract sum is what the business is being paid, and on a
-- construction site it is the single number people are most often told not to
-- discuss. Hiding it would need a per-project visibility model — a bigger
-- question than this pack, and one nobody has asked; Documents' owners-only
-- folder is where the signed agreement itself belongs today.
--
-- NO POLICY ON DELETE BEYOND THE MEMBER ONE, and none is needed: a contract goes
-- when its project goes, by the `job_contracts_project_fk` cascade, and a
-- contract that should not have existed is `cancelled` or `declined` rather than
-- removed. A signed agreement that was billed against is not a row to delete.
--
-- FORCEd for the reason every table here is: the app connects as `app_user`,
-- Neon's owner role has BYPASSRLS and must never be what the app uses, and the
-- policy is the backstop rather than the app code.

ALTER TABLE "job_contracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_contracts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_contracts_superadmin_all ON "job_contracts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_contracts_member_all ON "job_contracts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
