-- The inbox: RLS for the five new tables.
--
-- Three different shapes here, not one, because these tables answer to three
-- different threats.
--
-- Safe against the running code: all five tables are new (the 0025 lesson).

------------------------------------------------------------------------------
-- 1. mail_directory_accounts — the only table the MAIL SERVER can read.
--
-- Stalwart authenticates against this table over its own Postgres connection,
-- as a dedicated `stalwart_directory` role. That connection is the single
-- largest new attack surface in the platform: a mail server is internet-facing
-- by definition, and it now holds database credentials.
--
-- So its reach is bounded twice, independently:
--
--   * GRANT — scripts/create-mail-role.ts gives stalwart_directory SELECT on
--     this table and nothing else. It is not covered by the ALTER DEFAULT
--     PRIVILEGES that hands app_user every future table, so new tables are
--     invisible to it by default rather than by remembering.
--
--   * POLICY — the policy below keys on current_user. Even granted more, the
--     role reads only what a policy lets it read.
--
-- Either mechanism alone would do. Both, because the cost of being wrong is a
-- compromised mail server reading a client's ledger.
--
-- The policy is deliberately UNSCOPED by tenant: the mail server has to be able
-- to authenticate anybody, so it must see every login. That is exactly why this
-- table contains only addresses and password hashes — no business data — and
-- why nothing else is ever added to it.
--
-- Members get read on their own tenant's rows so the app can show who has a
-- mailbox. Nobody but trusted server code writes, because a member who could
-- write password_hash could set their own hash on a colleague's address.
------------------------------------------------------------------------------

ALTER TABLE "mail_directory_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_directory_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_directory_superadmin_all ON "mail_directory_accounts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_directory_member_read ON "mail_directory_accounts" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
-- The mail server. SELECT only, every tenant, this table alone.
CREATE POLICY mail_directory_mailserver_read ON "mail_directory_accounts" FOR SELECT
  USING (current_user = 'stalwart_directory');
--> statement-breakpoint

------------------------------------------------------------------------------
-- 2. mail_accounts — OAuth tokens.
--
-- member_read only. A token is a live credential: anyone holding one can read
-- the mailbox until it expires, which makes this the most dangerous row in the
-- database and the reason tokens are encrypted before they get here.
--
-- Read is not scoped to the connecting user, because RLS has no user identity
-- to scope by — withTenant sets app.role, app.tenant_id and app.tenant_role,
-- and no user id. The app filters by clerk_user_id on every read. What makes
-- the residual exposure uninteresting is the encryption, not the policy: the
-- key lives in the environment and never in this database, so a colleague who
-- selects the row gets ciphertext.
--
-- Writes are trusted-code-only. A member who could write these columns could
-- point an account at a token they control.
------------------------------------------------------------------------------

ALTER TABLE "mail_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_accounts_superadmin_all ON "mail_accounts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_accounts_member_read ON "mail_accounts" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

------------------------------------------------------------------------------
-- 3. mail_thread_index — derived from the mail server, never authored.
--
-- member_read only for the same reason as the send log: it is a record of what
-- the mail server said, and a forgeable one would be worse than none. Writes
-- happen during sync, under withSystem.
------------------------------------------------------------------------------

ALTER TABLE "mail_thread_index" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_thread_index" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_thread_index_superadmin_all ON "mail_thread_index"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_thread_index_member_read ON "mail_thread_index" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

------------------------------------------------------------------------------
-- 4 & 5. mail_links and mail_annotations — MEMBER WRITABLE.
--
-- The exception in this module, and deliberately so. Attaching a thread to an
-- invoice is ordinary daily work — the thing the product exists to make easy —
-- and routing it through owner-only server actions would make the core feature
-- feel like an administrative chore.
--
-- Safe to hand over because neither table can assert anything untrue about the
-- outside world. The worst a member can do is link a thread to the wrong
-- invoice or write a bad annotation, both visible and both reversible. Compare
-- mail_directory_accounts, where a bad write is an authentication bypass.
--
-- WITH CHECK pins tenant_id on insert and update, so a member cannot file a
-- link into another tenant even by handing us a forged id.
------------------------------------------------------------------------------

ALTER TABLE "mail_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_links_superadmin_all ON "mail_links"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_links_member_all ON "mail_links"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "mail_annotations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_annotations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_annotations_superadmin_all ON "mail_annotations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_annotations_member_all ON "mail_annotations"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
