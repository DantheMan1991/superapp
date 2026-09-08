-- credit_memos: RLS. ENABLE + FORCE. Members read; OWNERS insert and update;
-- nobody deletes; superadmin all — the posture deposits (0266) set for a
-- document only an owner can issue. The actions pass `{ role }` to withTenant
-- so the policy sees the caller's real role; a write that forgets is refused,
-- because the default role is `staff`. No DELETE policy: a memo is voided (an
-- UPDATE), never deleted. tests/isolation/credit-memos.test.ts asserts each
-- clause here.

ALTER TABLE "credit_memos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_memos" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_memos_superadmin_all ON "credit_memos"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY credit_memos_member_read ON "credit_memos" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY credit_memos_owner_insert ON "credit_memos" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY credit_memos_owner_update ON "credit_memos" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
