-- deposits: RLS. ENABLE + FORCE. Members read; OWNERS insert and update;
-- nobody deletes; superadmin all. docs/modules/accounting.md, 2026-09-07.
--
-- Owner-only writes AT THE DATABASE, unlike the older banking tables (0010),
-- which let any member write and lean on the app's owner check. The deposit
-- actions pass `{ role }` to withTenant so the policy sees the caller's real
-- role — the default is `staff`, the least privileged, which is why a write
-- that forgets to pass it is refused rather than let through.
--
-- No DELETE policy: a deposit is voided (an UPDATE), never deleted, and the
-- void is what clears the payments' deposit_id. A tenant's cascade delete
-- still removes its rows — referential actions bypass row security.
-- tests/isolation/deposits.test.ts asserts each clause here.

ALTER TABLE "deposits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deposits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY deposits_superadmin_all ON "deposits"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY deposits_member_read ON "deposits" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY deposits_owner_insert ON "deposits" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY deposits_owner_update ON "deposits" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
