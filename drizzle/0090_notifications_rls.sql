-- RLS for the two notification tables. Pattern per drizzle/0001_rls.sql
-- (ENABLE + FORCE + superadmin) and drizzle/0043 (per-PERSON scoping via
-- app_current_user()). The two tables get deliberately different treatment.

-------------------------------------------------------------------------------
-- notification_digest_log — a record of who was told what, per person per day.
--
-- SUPERADMIN ONLY. There is no member policy of any kind, and that is the
-- decision rather than an omission:
--
--   • Nothing in the product reads it. The digest cron writes it under
--     withSystem (trusted background code, S2) and reads the previous row the
--     same way. A policy for a caller that does not exist is one nobody is
--     maintaining against a threat nobody is thinking about.
--
--   • The rows say how much outstanding work each person was carrying, on
--     which days. The reflexive tenant-wide read policy would turn that into a
--     performance dashboard any colleague could query. That the rows hold only
--     identifiers does not make the COUNTS unrevealing.
--
-- If "when did my digests go out" is ever wanted, scope it to the acting
-- person with app_current_user() as below — never tenant-wide.
-------------------------------------------------------------------------------

ALTER TABLE "notification_digest_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_digest_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_digest_log_superadmin_all ON "notification_digest_log"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-------------------------------------------------------------------------------
-- notification_preferences — whether YOU want the morning email.
--
-- The rule the product wants is "you may read and set your own preference and
-- nobody else's", and here it is enforced by Postgres rather than by whichever
-- server action remembers to check. Same shape as mail_accounts (0043): the
-- policy joins to profiles and compares clerk_user_id against
-- app_current_user().
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON memberships: 0085 deliberately made
-- owner rows unwritable from tenant context so a background job could trust
-- memberships.role. A preference living there would inherit that, and owners
-- could never switch their own digest off without a withSystem write inside a
-- user-facing action. Splitting it buys the stricter rule AND a simpler one.
--
-- Note the direction of failure: app_current_user() returns NULL when the
-- caller forgot to pass userId to withTenant, and NULL matches no profile, so
-- a forgetful caller reads and writes NOTHING rather than everything. Same
-- property every per-person policy in this codebase has.
-------------------------------------------------------------------------------

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_superadmin_all ON "notification_preferences"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY notification_preferences_own_read ON "notification_preferences"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "profiles" p
       WHERE p."id" = "notification_preferences"."profile_id"
         AND p."clerk_user_id" = app_current_user()
    )
  );
--> statement-breakpoint
CREATE POLICY notification_preferences_own_insert ON "notification_preferences"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "profiles" p
       WHERE p."id" = "notification_preferences"."profile_id"
         AND p."clerk_user_id" = app_current_user()
    )
  );
--> statement-breakpoint
CREATE POLICY notification_preferences_own_update ON "notification_preferences"
  FOR UPDATE USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "profiles" p
       WHERE p."id" = "notification_preferences"."profile_id"
         AND p."clerk_user_id" = app_current_user()
    )
  ) WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "profiles" p
       WHERE p."id" = "notification_preferences"."profile_id"
         AND p."clerk_user_id" = app_current_user()
    )
  );
