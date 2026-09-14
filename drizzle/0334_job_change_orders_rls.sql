-- job_change_orders + job_change_order_lines: RLS. Pattern per
-- drizzle/0332_job_budget_rls.sql — ENABLE + FORCE, superadmin_all, member_all,
-- on both tables.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Approving a change order is an `owner` verb there — it is the one
-- act that moves a signed contract's value and a budget at once — while
-- proposing one and reading them is ordinary work for whoever is running the
-- job.
--
-- WHAT A COLLEAGUE MAY SEE is the price of a change beside its cost, which is
-- the margin on that change written down. The same caution 0328 and 0332 carry,
-- and the same answer: hiding it needs a per-project visibility model nobody
-- has asked for yet. Recorded so the day somebody does ask, the answer is "that
-- was a known choice".
--
-- NO DELETE POLICY BEYOND THE MEMBER ONE. A change order goes when its contract
-- goes, by cascade; its lines go with it. A cost code with a change against it
-- is retired rather than deleted, which `job_change_order_lines_code_fk`
-- RESTRICT enforces — the same rule a commitment line and a budget line follow.

ALTER TABLE "job_change_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_change_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_change_orders_superadmin_all ON "job_change_orders"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_change_orders_member_all ON "job_change_orders"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_change_order_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_change_order_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_change_order_lines_superadmin_all ON "job_change_order_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_change_order_lines_member_all ON "job_change_order_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
