-- mail_autofile_rules — the SIXTH per-user table, after mail_accounts/
-- mail_thread_index (0043), mail_saved_searches (0048), mail_snoozes (0050),
-- mail_rules (0052) and mail_scheduled_sends (0054).
--
-- WHY PER-USER, and the reason is the opposite shape to the others. Rules,
-- snoozes and scheduled sends are per-user partly because the rows are
-- MEANINGLESS elsewhere — they name JMAP ids issued inside one account. These
-- rows would work perfectly well for a colleague, and that is exactly why they
-- must not be theirs to create.
--
-- **Filing publishes one person's private correspondence to the whole
-- business.** The manual path has always required a human to press a button,
-- and it audits inside its transaction rather than fire-and-forget precisely
-- because of what it discloses. An automatic version removes that human. So the
-- right to say "everything arriving here goes into the shared cabinet" belongs
-- to the person whose mailbox it is and to nobody else — which is a statement
-- about authorization, and therefore belongs in a policy rather than in a
-- predicate somebody has to remember to write.
--
-- MEMBER WRITABLE, like the other four. Setting up filing for your own mailbox
-- is ordinary work. The WITH CHECK pins BOTH tenant_id and clerk_user_id, and
-- on this table the write side carries the weight: a forged row would make the
-- SWEEP — which runs under withSystem, where RLS is not standing behind it —
-- file a COLLEAGUE'S mail into a shared folder on a schedule. That is the
-- disclosure this policy exists to prevent, and it is the same reasoning
-- mail_scheduled_sends records for forging a send.
--
-- WHAT THIS TABLE IS NOT. It holds no mail. Not a body, not an attachment, not
-- a subject line — only which connection to watch, what to match, and where the
-- copy goes. The copies live in Documents under Documents' own RLS; the
-- messages stay on the mail server. Losing every row here stops future filing
-- and loses nothing already filed.
--
-- Safe against the running code: the table is new, so nothing already deployed
-- reads or writes it (the 0025 lesson).

ALTER TABLE "mail_autofile_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_autofile_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY mail_autofile_rules_superadmin_all ON "mail_autofile_rules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- One policy for all four verbs: this row is yours or it is invisible.
--
-- app_current_user() returns NULL when unset, so a caller who forgets
-- `{ userId }` reads ZERO rows rather than the tenant's — the direction that
-- fails safe, and the same property every per-user table here is built on.
------------------------------------------------------------------------------

CREATE POLICY mail_autofile_rules_member_all ON "mail_autofile_rules"
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- The destination folder's composite FK, which schema.ts cannot express.
--
-- It needs `ON DELETE SET NULL (destination_folder_id)` — the column-list form
-- added in PG 15 — and drizzle-kit has no way to emit it. This is the second
-- constraint in this schema to take that exception; mail_links.mail_account_id
-- (drizzle/0046) was the first, and the failure it avoids is the same one.
--
-- WHY THE COLUMN LIST IS LOAD-BEARING. A composite FK's plain
-- `ON DELETE SET NULL` nulls EVERY column in the key, `tenant_id` included —
-- and that is NOT NULL. So **deleting a Documents folder would fail outright**
-- with a not-null violation for any tenant that had a rule pointing at it.
-- Tidying up the cabinet would start erroring, and the cause would be a mail
-- feature nobody was thinking about.
--
-- WHY SET NULL RATHER THAN CASCADE. A null destination means "file into the
-- Documents inbox", which is the correct degradation: somebody deleted a
-- folder, they did not ask to stop filing their supplier's invoices. CASCADE
-- would silently delete the standing instruction, and the first anybody would
-- know is a month of missing paperwork.
--
-- WHY COMPOSITE AND NOT SINGLE-COLUMN. This is a member-writable table, and RLS
-- pins tenant_id on insert but nothing else would stop a member naming another
-- tenant's folder id. It grants no read — that folder is invisible to them —
-- but the house rule is that cross-tenant references are structurally
-- impossible rather than merely useless, and tests/tenant-isolation.test.ts
-- certifies every composite FK in the mail schema.
------------------------------------------------------------------------------

ALTER TABLE "mail_autofile_rules"
  ADD CONSTRAINT "mail_autofile_rules_folder_fk"
  FOREIGN KEY ("tenant_id", "destination_folder_id")
  REFERENCES "document_folders" ("tenant_id", "id")
  ON DELETE SET NULL ("destination_folder_id");
