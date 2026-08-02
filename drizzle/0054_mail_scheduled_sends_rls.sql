-- mail_scheduled_sends — the FIFTH table scoped to one person rather than to
-- the business, after mail_accounts/mail_thread_index (0043),
-- mail_saved_searches (0048), mail_snoozes (0050) and mail_rules (0052).
--
-- WHY PER-USER. The same two reasons as snoozes, and the first alone settles it.
--
-- The columns are unshareable. `email_id`, `identity_id`, `drafts_mailbox_id`
-- and `sent_mailbox_id` are all ids the mail server issues inside ONE person's
-- account. Handed to a colleague they name a draft and a folder that do not
-- exist for them — or worse, different ones that happen to share an id.
--
-- And the row is correspondence. A list of what somebody has queued to send,
-- to which addresses, and at what hour, says as much as the subject lines
-- mail_thread_index is already scoped for. "Everything Dan has lined up to go
-- out at 6am on Monday" is not a colleague's business.
--
-- MEMBER WRITABLE, like snoozes and saved searches. Scheduling your own mail is
-- ordinary work, and the worst a member can do to their own rows is pick a bad
-- time — visible and reversible. That is nothing like mail_accounts, which
-- refuses member writes because a member who could write one could point an
-- account at a token they control.
--
-- The WITH CHECK pins BOTH tenant_id and clerk_user_id, so a member can no more
-- queue a message attributed to a colleague than read one. That matters more
-- here than on any previous per-user table: a forged row would make the SWEEP
-- send a message on somebody else's behalf, from their address.
--
-- ONE THING THIS TABLE IS NOT. It is not where the message is. The draft lives
-- on the mail server; these rows only remember which draft, and when to submit
-- it. Losing every row here loses no writing — it leaves finished messages
-- sitting in Drafts, which is where somebody would look for them. No body, no
-- attachment and no recipient NAME is stored, so the module's founding
-- invariant survives intact.

ALTER TABLE "mail_scheduled_sends" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_scheduled_sends" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY mail_scheduled_sends_superadmin_all ON "mail_scheduled_sends"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- One policy for all four verbs, because the answer is the same for all four:
-- this row is yours or it is invisible.
--
-- app_current_user() returns NULL when unset, so a caller who forgets
-- `{ userId }` reads ZERO rows rather than the tenant's — the fail-closed
-- direction every setting in this system is built with.
--
-- The cron sweep does NOT come through here. It has no session and no user, so
-- it runs under withSystem() like the snooze sweep beside it. That is the
-- documented exception for trusted background code, and it is why the sweep
-- must take its own care to submit each draft through the account the row
-- names: RLS is not standing behind it.
------------------------------------------------------------------------------

CREATE POLICY mail_scheduled_sends_member_all ON "mail_scheduled_sends"
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
