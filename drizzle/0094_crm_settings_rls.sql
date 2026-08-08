-- CRM settings: policies. Mirrors accounting_settings (drizzle/0008) exactly,
-- and for the same reason.
--
-- MEMBER-ALL, not member-read + server-write. That is a wider grant than the
-- notification tables got this week, so it is worth saying why it is right
-- here: the AI cooldown is CLAIMED inside the caller's own tenant transaction,
-- in the same statement that checks it. That claim-on-read is what makes two
-- people pasting notes at once serialize on the row instead of both spending a
-- model call. Pushing the write to withSystem would mean either a second
-- transaction (breaking the atomicity the gate depends on) or moving the whole
-- gate to system context (which would let it run for a caller RLS had already
-- refused).
--
-- What that grant actually exposes is one nullable timestamp about when this
-- tenant last used the extractor. There is no cross-tenant reach — the policy
-- is scoped to app_current_tenant() on both sides — and nothing here is data
-- about a person.
--
-- The row is created lazily by the extractor's first run, so a tenant that
-- never uses AI never gets one.

ALTER TABLE "crm_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_settings_superadmin_all ON "crm_settings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_settings_member_all ON "crm_settings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
