-- livestock_daily_logs: RLS. Pattern per drizzle/0139_livestock_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, and this is the table where that stops being a preference. The
-- daily round is walked by whoever is in the pens, which at 10x is not the
-- owner; a policy that let only owners write here would mean the check that
-- distinguishes "zero died" from "didn't check" simply never gets recorded.
-- RLS answers "whose rows are these"; who may write which verb is the pack's
-- action layer, and `recordDailyCheck` is a `member` verb on purpose.

ALTER TABLE "livestock_daily_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_daily_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_daily_logs_superadmin_all ON "livestock_daily_logs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_daily_logs_member_all ON "livestock_daily_logs"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
