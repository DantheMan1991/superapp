-- mail_templates — the FIRST mail table scoped to the BUSINESS rather than to
-- one person, and the departure is deliberate enough to be worth the paragraph.
--
-- The five before it (mail_accounts/mail_thread_index 0043, mail_saved_searches
-- 0048, mail_snoozes 0050, mail_rules 0052, mail_scheduled_sends 0054) are all
-- per-user, and each migration gives the same two reasons: the rows hold
-- correspondence, or they hold ids the mail server issued inside ONE account.
--
-- A template holds neither. It is boilerplate somebody wrote SO THAT it would
-- be reused — the company's payment terms, the reply to a new enquiry — and a
-- copy per employee is the problem it exists to solve. There is no
-- `clerk_user_id` to scope by and no `mail_account_id` either: a template
-- belongs to the business, so the same wording is available from a personal
-- mailbox and from a shared info@ without being stored twice.
--
-- WHY NOT ON THE MAIL SERVER, since every other organising feature is. It is
-- not for want of asking: `npm run mail:probe-templates` confirmed a `$draft`
-- message in a mailbox of its own works, round-trips its markup, and does not
-- pollute the Drafts folder — literally Gmail's original canned responses.
-- Every such location is scoped to one ACCOUNT, so sharing a template would
-- mean granting a colleague the mailbox holding it and every message in it.
-- There is no way to share the wording without sharing the correspondence.
--
-- The accepted cost: a template does NOT travel to a phone or to Outlook, and
-- it is the first mail feature since Slice 0 of which that is true. Usable by
-- the whole company beat usable in another client, which is the opposite of how
-- every previous call in this module went.
--
-- MEMBER_ALL, the ordinary tenant shape from 0014 — the same policy
-- document_templates got in 0034, and for the same reason. A template is not
-- visibility-bearing: it is a blank form the business wrote, not a document, so
-- there is no owners-only dimension and no app_current_tenant_role() term.
--
-- `created_by_clerk_user_id` is RECORDED, not enforced. Any member may edit or
-- delete any template, which is the same answer document_templates gives: a
-- colleague correcting the payment-terms wording is somebody doing their job,
-- and the worst case is retyping a paragraph. That is nothing like
-- mail_accounts, which refuses member writes outright because a member who
-- could write one could point an account at a token they control.
--
-- Safe against the running code: the table is new, so nothing already deployed
-- reads or writes it (the 0025 lesson — migrations run against the live
-- database BEFORE the new code deploys).

ALTER TABLE "mail_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_templates_superadmin_all ON "mail_templates"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY mail_templates_member_all ON "mail_templates"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
