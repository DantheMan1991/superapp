-- Per-user mailbox isolation: the fourth RLS setting.
--
-- THE HOLE THIS CLOSES. A mailbox is one person's private correspondence, and
-- the product has always said so. But until now that separation existed only in
-- application code: `mail_accounts_member_read` scoped rows to the TENANT, and
-- every read in src/lib/email/oauth/accounts.ts ran under withSystem() — which
-- sets app.role = 'superadmin', so the member policy never fired on the app
-- path at all. Per-user privacy was "the app remembered to filter by
-- clerk_user_id" and nothing more.
--
-- That was survivable while the only caller was the OAuth callback. It stops
-- being survivable the moment an inbox UI reads these tables on every page: one
-- forgotten predicate and a colleague is reading somebody's mail. So the
-- guarantee moves into the database, where forgetting is not possible.
--
-- Why now rather than later: mail_thread_index is still empty and mail_accounts
-- holds a handful of rows. Changing a policy is cheapest before the data it
-- governs exists, and before Slice 5 starts joining these tables from other
-- modules.
--
-- WHAT THIS DOES NOT CHANGE. Message bodies are not in this database — they
-- live on the mail server and need that person's own OAuth token to read. This
-- migration hardens the second layer, not the first. Shared mailboxes
-- (mailboxes.clerk_user_id IS NULL) stay shared: several people each connect
-- them and each gets their own mail_accounts row, so the policy below already
-- does the right thing without a special case.

------------------------------------------------------------------------------
-- The setting itself.
--
-- Returns NULL when unset, exactly like app_current_tenant(). That is the
-- fail-closed direction: `clerk_user_id = NULL` is NULL, never true, so a
-- transaction that forgot to pass a user id reads ZERO rows rather than all of
-- the tenant's. A forgotten opt-in must deny, never grant — the same property
-- app.tenant_role was built with (drizzle/0024).
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_user() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.clerk_user_id', true), '');
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

------------------------------------------------------------------------------
-- mail_accounts — a person's OAuth connection to a mailbox.
--
-- The most dangerous row in the database: whoever holds the token can read the
-- mailbox until it expires. Encryption is what makes a stolen row uninteresting;
-- this policy is what stops it being handed over in the first place.
--
-- Writes stay trusted-code-only. A member who could INSERT or UPDATE here could
-- point an account at a token they control, which is an authentication bypass
-- rather than a data error.
--
-- DELETE is the one exception, and it is new. Disconnecting your own mailbox is
-- ordinary work, not an administrative act, and scoping the policy to the
-- connecting user makes deleting a COLLEAGUE'S connection structurally
-- impossible rather than merely unimplemented. It also removes a withSystem()
-- call from a user-triggered path, which is the direction S2 asks for.
------------------------------------------------------------------------------

DROP POLICY IF EXISTS mail_accounts_member_read ON "mail_accounts";
--> statement-breakpoint
CREATE POLICY mail_accounts_member_read ON "mail_accounts" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
CREATE POLICY mail_accounts_member_delete ON "mail_accounts" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- mail_thread_index — subjects, participants and dates of a person's threads.
--
-- Carries no clerk_user_id of its own; it hangs off mail_accounts. The EXISTS
-- below is therefore the honest expression of "this thread belongs to a mailbox
-- I connected".
--
-- Note what makes this safe rather than merely correct: the subquery reads
-- mail_accounts, so mail_accounts' OWN policy applies to it. The two policies
-- compose — there is no path where this one is stricter than the table it
-- depends on, and no path where it is looser. Tightening mail_accounts later
-- automatically tightens this.
--
-- A subject line is not a body, but it is still correspondence: "Re: your
-- disciplinary hearing" in a colleague's thread list is a leak even though no
-- message was read. Hence the same scope as the account itself.
--
-- Writes remain trusted-code-only: these rows are derived from what the mail
-- server said, and a forgeable index would be worse than none.
------------------------------------------------------------------------------

DROP POLICY IF EXISTS mail_thread_index_member_read ON "mail_thread_index";
--> statement-breakpoint
CREATE POLICY mail_thread_index_member_read ON "mail_thread_index" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1
      FROM "mail_accounts" a
      WHERE a."id" = "mail_thread_index"."mail_account_id"
        AND a."tenant_id" = "mail_thread_index"."tenant_id"
        AND a."clerk_user_id" = app_current_user()
    )
  );
