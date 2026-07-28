-- The composite tenant FK for mail_links.mail_account_id, and nothing else.
--
-- Separate from 0045 (which added the column and reshaped the unique index)
-- because this constraint cannot be expressed in schema.ts at all: it needs
-- `ON DELETE SET NULL (mail_account_id)`, the column-list form added in PG 15,
-- and drizzle-kit has no way to emit it.
--
-- WHY THE COLUMN LIST IS LOAD-BEARING. A composite FK's plain
-- `ON DELETE SET NULL` nulls EVERY column in the key — here that would include
-- `tenant_id`, which is NOT NULL. Disconnecting a mailbox would then fail with a
-- not-null violation instead of doing the right thing, and it would fail at the
-- worst possible moment: someone revoking access to their own private mail.
--
-- WHY SET NULL RATHER THAN CASCADE. The whole reason linking COPIES a message
-- into Documents rather than pointing at the mailbox is that the link has to
-- survive the person who made it — their token expiring, their disconnecting the
-- mailbox, their leaving the business. That is precisely when the
-- correspondence behind an invoice is most wanted. CASCADE would delete the link
-- at exactly that moment and quietly undo the design. SET NULL keeps the link
-- and drops only the thing that has genuinely been lost: the route back to the
-- live thread. The filed copy in Documents is still there, still readable, and
-- still inherits Documents' own RLS.
--
-- WHY A COMPOSITE FK AND NOT A SINGLE-COLUMN ONE. `mail_links` is one of the two
-- member-WRITABLE tables in this module. RLS pins `tenant_id` on insert, but
-- nothing else would stop a member writing another tenant's `mail_account_id`
-- into their own row. It grants no read — that account is invisible to them —
-- but the house rule is that cross-tenant references are structurally
-- impossible rather than merely useless, and every other composite FK in the
-- mail schema is certified by tests/tenant-isolation.test.ts. This one now is
-- too.
--
-- NULLS DISTINCT (the default) on mail_links_unique_idx is the deliberate
-- partner of SET NULL: orphaned links compare as distinct, so nulling a column
-- can never collide with an existing row, so a DELETE on mail_accounts can never
-- be blocked by a unique violation. Nothing in the application inserts a null
-- `mail_account_id`, which is what keeps the index total in practice.

ALTER TABLE "mail_links"
  ADD CONSTRAINT "mail_links_account_fk"
  FOREIGN KEY ("tenant_id", "mail_account_id")
  REFERENCES "mail_accounts" ("tenant_id", "id")
  ON DELETE SET NULL ("mail_account_id");
