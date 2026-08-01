-- mail_snoozes — the THIRD table scoped to one person rather than to the
-- business, after mail_accounts/mail_thread_index (0043) and
-- mail_saved_searches (0048).
--
-- WHY PER-USER. Two reasons, and the first alone would settle it.
--
-- The columns are unshareable. `return_to_mailbox_id` and `snooze_mailbox_id`
-- are JMAP mailbox ids, which the mail server issues inside ONE person's
-- account. Handed to a colleague they name a folder that does not exist for
-- them — or worse, a different folder that happens to share an id. The same
-- data-model fact that scoped saved searches applies here unchanged.
--
-- And the row is a diary entry. "Remind me about this on Tuesday" says what
-- somebody is putting off and until when, message by message. A colleague
-- reading the list of what you have deferred, and the deadline you set
-- yourself, is a privacy problem whether or not they can open the mail behind
-- it.
--
-- MEMBER WRITABLE, like saved searches. Deferring your own mail is ordinary
-- daily work, and the worst a member can do to their own snoozes is set a bad
-- time, which is visible and reversible. That is nothing like mail_accounts,
-- which refuses member writes because a member who could write one could point
-- an account at a token they control.
--
-- The WITH CHECK pins BOTH tenant_id and clerk_user_id, so a member can no more
-- create a snooze attributed to a colleague than read one.
--
-- ONE THING THIS TABLE IS NOT. It is not where the mail is. Snoozing MOVES the
-- message into a Snoozed folder on the mail server; these rows only remember
-- where it came from and when to put it back. Losing every row here loses no
-- mail — it leaves a pile of messages sitting in a visible folder, waiting to
-- be dragged back by hand. These policies are about privacy, not custody.

ALTER TABLE "mail_snoozes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_snoozes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY mail_snoozes_superadmin_all ON "mail_snoozes"
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
-- it runs under withSystem() like the mail-sync cron beside it. That is the
-- documented exception for trusted background code, and it is why the sweep
-- has to take its own care never to act on behalf of the wrong account: RLS is
-- not standing behind it.
------------------------------------------------------------------------------

CREATE POLICY mail_snoozes_member_all ON "mail_snoozes"
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
