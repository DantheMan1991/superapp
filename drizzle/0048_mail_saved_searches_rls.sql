-- mail_saved_searches — the SECOND table scoped to one person rather than to
-- the business, and only the second in the whole schema.
--
-- WHY PER-USER, when document_saved_views is tenant-wide and shareable. A saved
-- view in Documents names a folder id, and a folder id means the same thing to
-- everybody in the business — so sharing one is useful and safe. A mail search
-- names a JMAP MAILBOX id, which the mail server issues inside ONE person's
-- account. Hand it to a colleague and it points at a folder that does not exist
-- for them, or, worse, at a different folder that happens to share an id. The
-- feature cannot be shared because the identifiers are not shareable.
--
-- That is a data-model fact, not a privacy preference — but the privacy
-- consequence follows anyway, and it is the one that decides the policy: the
-- NAME of a saved search is correspondence. "Unread from the solicitor" or
-- "anything about the disciplinary" tells a colleague what somebody is dealing
-- with, and the same reasoning that scoped mail_accounts and mail_thread_index
-- to app.clerk_user_id in 0043 applies unchanged here.
--
-- MEMBER WRITABLE, unlike the other per-user mail tables. mail_accounts refuses
-- member writes because a member who could write one could point an account at
-- a token they control — an authentication bypass. Nothing of the sort is true
-- here: the worst a member can do to their OWN saved searches is save a bad one,
-- which is visible and reversible. Naming a view is ordinary daily work, in the
-- same way attaching a thread to an invoice is (0042).
--
-- The WITH CHECK pins BOTH tenant_id and clerk_user_id, so a member cannot
-- create a search attributed to a colleague any more than they can read one.

ALTER TABLE "mail_saved_searches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_saved_searches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY mail_saved_searches_superadmin_all ON "mail_saved_searches"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- One policy for all four verbs, because the answer is the same for all four:
-- this row is yours or it is invisible.
--
-- app_current_user() returns NULL when unset, so a caller who forgets
-- `{ userId }` reads ZERO rows rather than the tenant's — the fail-closed
-- direction every setting in this system is built with, and the property any
-- future one must also have.
------------------------------------------------------------------------------

CREATE POLICY mail_saved_searches_member_all ON "mail_saved_searches"
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
