-- Outbound email: RLS for the two new tables.
--
-- Both are member_READ-only (the drizzle/0020 retainers pattern), for the same
-- reason in each case: their contents are facts about what the platform did,
-- not tenant intent.
--
--   * email_domains holds a provider's domain id and verification state. If a
--     member could write it, they could mark their own domain "verified" and
--     the app would start trying to send as a domain they never proved they
--     own. Verification status is the provider's word, relayed by trusted
--     server code — never the tenant's claim.
--
--   * outbound_emails records what was actually sent and what the provider
--     said happened to it. A forgeable "delivered" is worse than no log at
--     all, because someone will rely on it in a dispute.
--
-- Writes therefore run under withSystem, from src/lib/email/, after
-- requireTenantOwner() has authorized the caller in app code.
--
-- Safe against the running code: both tables are new (the 0025 lesson).

ALTER TABLE "email_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_domains" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY email_domains_superadmin_all ON "email_domains"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY email_domains_member_read ON "email_domains" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "outbound_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbound_emails" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY outbound_emails_superadmin_all ON "outbound_emails"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY outbound_emails_member_read ON "outbound_emails" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
