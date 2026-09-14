-- job_budget_lines: RLS. Pattern per drizzle/0330_job_commitments_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Setting a budget is an `owner` verb there — it is the figure every
-- variance on the job is measured against — while reading it is ordinary work
-- for anybody deciding whether to order more of something.
--
-- WHAT A COLLEAGUE MAY SEE IS THE PLAN, and that is the sharpest version yet of
-- the caution 0326 and 0328 already carry. A budget by cost code tells a
-- carpenter what the business expected to pay for carpentry, which is closer to
-- a margin than anything else in this pack. Hiding it needs a per-project
-- visibility model — a bigger question than this slice, and one nobody has
-- asked. It is written down here so the day somebody does ask, the answer is
-- "that was a known choice" rather than "nobody thought about it".
--
-- NO DELETE POLICY BEYOND THE MEMBER ONE. A budget line goes when its project
-- goes, by cascade. Removing a code from a budget is setting it to zero or
-- deleting the row through the ordinary member policy; a code with a budget
-- against it is retired rather than deleted, which the `job_budget_lines_code_fk`
-- RESTRICT enforces.

ALTER TABLE "job_budget_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_budget_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_budget_lines_superadmin_all ON "job_budget_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_budget_lines_member_all ON "job_budget_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
