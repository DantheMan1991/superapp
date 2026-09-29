-- Workouts F4a (reminders): RLS on the table 0430 made. The same pattern as
-- 0427 and 0429: the superadmin policy for the god view, the member policy
-- for the tenant's own rows. A personal space is an ordinary tenant to RLS.
-- The cron that sends the reminders finds them across spaces under
-- withSystem (trusted background code, as the digest does), then claims and
-- reads each space's own rows under withTenant.
ALTER TABLE "fitness_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fitness_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fitness_reminders_superadmin_all ON "fitness_reminders"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY fitness_reminders_member_all ON "fitness_reminders"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
