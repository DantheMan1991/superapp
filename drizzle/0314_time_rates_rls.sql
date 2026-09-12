-- time_rates: RLS, and THE FIRST TABLE IN THIS MODULE THAT IS NOT MEMBER-WIDE.
--
-- Everything else in Time is deliberately visible to the whole team: a
-- timesheet is a shared record, and somebody logging a crew's afternoon has to
-- be able to find the crew. What people are PAID is a different question, and
-- "everyone can see the hours" was never an argument for "everyone can see the
-- wage bill".
--
-- The term is `app_current_tenant_role() = 'owner'`, the shape the Documents
-- module's owners-only folders use (drizzle/0024). Two consequences worth
-- knowing before touching this:
--
--  1. `withTenant` DEFAULTS TO 'staff' -- the least privileged value -- so a
--     caller that forgets `{ role: ctx.role }` sees an empty table rather than
--     everybody's wages. Failing closed is the whole reason the default is what
--     it is (AGENTS.md), and it makes the omission a missing figure rather than
--     a leak.
--  2. A read that comes back empty means EITHER "there are none" OR "you may
--     not see them". Nothing downstream tries to tell those apart: both are
--     "no money figure to show", and `SheetTotals.grossCents` is null for each.
--
-- A superadmin in a live support view is NOT an owner of the client's
-- workspace: `requireTenant()` resolves that session as `staff` (back-office
-- slice 4), so support sees the hours and not the wages. That is the right way
-- round and it falls out of the existing rule rather than needing one here.
--
-- Pattern otherwise per drizzle/0301_time_rls.sql: ENABLE + FORCE,
-- superadmin_all, member_all. FORCEd because the app connects as `app_user`
-- and the policy is the backstop, not the app code.

ALTER TABLE "time_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_rates_superadmin_all ON "time_rates"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY time_rates_owner_all ON "time_rates"
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
