-- livestock_weights: RLS. Pattern per drizzle/0139_livestock_rls.sql — ENABLE +
-- FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, for the same reason `livestock_daily_logs` is. Catching ten birds
-- and putting them in a crate is a chore done by whoever is in the pen, and a
-- weighing that waits for the owner to be free is a weighing taken on the wrong
-- day — which for a broiler at seven weeks is most of the information gone.
--
-- RLS answers "whose rows are these"; which verb needs which role is the pack's
-- action layer, and `recordWeight` is a `member` verb on purpose.
--
-- These rows are also the denominator of the only number the broiler enterprise
-- is judged on, so cross-tenant leakage here would not merely expose data — it
-- would let another farm's scale readings into this farm's feed conversion.

ALTER TABLE "livestock_weights" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_weights" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_weights_superadmin_all ON "livestock_weights"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_weights_member_all ON "livestock_weights"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
