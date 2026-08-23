-- production_run_carcasses: RLS. Pattern per drizzle/0169_production_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, like every other pack table, and here the reason is concrete
-- rather than conventional: transcribing a kill sheet is a chore somebody does
-- at a kitchen table with a piece of paper in front of them, not a decision. The
-- pack's own layer keeps it at `member` for exactly that reason, and RLS answers
-- only "whose rows are these".
--
-- IT IS THE LAST LINK IN THE TRACEABILITY CHAIN, and the one that names an
-- animal. `production_run_inputs` says a pen went in and
-- `production_run_outputs` says boxes came out; this row is the carcass between
-- them, carrying a tag, a weight and — when a plant condemned it — the reason.
-- A row visible across a tenant boundary would attribute one farm's condemnation
-- to another farm's animals, which is worse than an ordinary leak: a
-- condemnation is a statement about whether meat was fit to sell.
--
-- Cascade deletes reach it from BOTH sides (the run and the input), so a row can
-- never outlive the chain it belongs to and become an orphaned claim about an
-- animal nothing else in the database remembers.

ALTER TABLE "production_run_carcasses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_run_carcasses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_run_carcasses_superadmin_all ON "production_run_carcasses"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_run_carcasses_member_all ON "production_run_carcasses"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
