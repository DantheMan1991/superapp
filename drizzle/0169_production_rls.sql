-- production_runs, production_run_inputs, production_run_outputs: RLS.
-- Pattern per drizzle/0137_inventory_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all.
--
-- MEMBER-WIDE, like every other pack table. RLS answers "whose rows are these";
-- which verb needs which role is the pack's own layer, and there the split is
-- real: starting and finishing a run are `owner` because finishing creates a
-- cost object per output, while recording what went in and what came off the
-- line are `member`, because a processing day is two or three people and none of
-- them is necessarily the owner.
--
-- WHY ALL THREE GET THEIR OWN POLICY PAIR RATHER THAN LEANING ON THE RUN'S.
-- These rows are half of a traceability chain that ends on a processor's
-- paperwork: an input names the batch of animals that went in, an output names
-- the batch of meat that came out, and between them they are what says this
-- package came from that pen. `inventory_movements` is FORCEd in its own right
-- for exactly that reason and these are the other end of the same chain.
--
-- Cross-tenant leakage here would not merely expose data. An input row visible
-- across a boundary would attribute another farm's animals to this farm's
-- carcasses, which is the one claim the chain exists to make truthfully.

ALTER TABLE "production_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_runs_superadmin_all ON "production_runs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_runs_member_all ON "production_runs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "production_run_inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_run_inputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_run_inputs_superadmin_all ON "production_run_inputs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_run_inputs_member_all ON "production_run_inputs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "production_run_outputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_run_outputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_run_outputs_superadmin_all ON "production_run_outputs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_run_outputs_member_all ON "production_run_outputs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
