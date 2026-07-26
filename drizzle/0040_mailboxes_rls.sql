-- Hosted mailboxes: RLS for the two new tables.
--
-- Both are member_READ-only, the same shape as email_domains/outbound_emails
-- in 0031, and for a sharper version of the same reason.
--
--   * mailbox_domains holds provisioning and activation state for a domain
--     whose MX we control. A member who could write `status` could mark a
--     domain 'active' that was never proved, never cut over, and possibly
--     belongs to someone else. Worse, they could clear `previous_mx` — the
--     only stored copy of what the domain's mail routing looked like before we
--     touched it, and the thing a rollback reads. Activation state is the
--     provider's word plus an owner's explicit consent, relayed by trusted
--     server code; it is never the tenant's claim.
--
--   * mailboxes is the list of real addresses that exist. A member who could
--     INSERT here could mint an address the provider has never heard of, and a
--     member who could UPDATE could repoint someone else's mailbox at their own
--     user id. Creating a mailbox is a provider call that costs money and hands
--     out the ability to read mail, which is owner-level authority.
--
-- Reading is deliberately open to all members: the set of addresses at a
-- company is a staff directory, not a secret, and staff need to see which
-- shared boxes exist before anything can be routed to them.
--
-- No credential of any kind is stored in either table, so a read policy here
-- can never leak a way IN to a mailbox — only the fact that one exists.
--
-- Writes therefore run under withSystem, from src/lib/email/mailbox/, after
-- requireTenantOwner() has authorized the caller in app code.
--
-- Safe against the running code: both tables are new (the 0025 lesson).

ALTER TABLE "mailbox_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mailbox_domains" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mailbox_domains_superadmin_all ON "mailbox_domains"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mailbox_domains_member_read ON "mailbox_domains" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "mailboxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mailboxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mailboxes_superadmin_all ON "mailboxes"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mailboxes_member_read ON "mailboxes" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
