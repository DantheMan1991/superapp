-- mail_rules — the FOURTH per-user table, after mail_accounts/mail_thread_index
-- (0043), mail_saved_searches (0048) and mail_snoozes (0050).
--
-- WHY PER-USER, and here the reason is stronger than privacy alone. A Sieve
-- script belongs to the account it runs in, and `file_into_mailbox_id` is a
-- JMAP id the mail server issued inside ONE person's account. A colleague's
-- rule is not merely private — it is meaningless in anybody else's mailbox,
-- because the folder it names does not exist there.
--
-- The privacy consequence follows anyway. "Anything from the solicitor goes
-- straight to a folder I look at on Fridays" describes how somebody is
-- handling a matter, and the rule NAME alone often gives it away.
--
-- MEMBER WRITABLE, like saved searches and snoozes. Writing a rule that files
-- your own mail badly is visible and reversible, and the compiler refuses the
-- two shapes that are not — a rule with no tests (which would match every
-- message) and one with no action.
--
-- WHAT THIS TABLE IS NOT: the truth. It is the SOURCE. Rules compile to a
-- single Sieve script that lives on the mail server and executes there. Losing
-- every row here leaves the last compiled script still sorting mail, which is
-- the correct failure — delivery keeps working and only editing stops.

ALTER TABLE "mail_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY mail_rules_superadmin_all ON "mail_rules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- One policy for all four verbs: this row is yours or it is invisible.
--
-- app_current_user() returns NULL when unset, so a caller who forgets
-- `{ userId }` reads ZERO rows rather than the tenant's.
--
-- Note what a leak would cost HERE specifically. Reading another person's
-- rules is bad; WRITING one would let a member add a rule to a colleague's
-- script that files their mail somewhere they never look — silent, server-side
-- and invisible from the inbox. The WITH CHECK pinning clerk_user_id is what
-- prevents that, and it matters more on this table than on any other.
------------------------------------------------------------------------------

CREATE POLICY mail_rules_member_all ON "mail_rules"
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
