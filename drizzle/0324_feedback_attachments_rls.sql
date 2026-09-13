-- feedback_attachments: RLS. ENABLE + FORCE.
--
-- ============================================================================
-- THE SAME POSTURE AS THE THREAD IT HANGS OFF
-- ============================================================================
--
-- A screenshot is part of a report, so it is visible to exactly whoever may
-- read that report: the person who filed it, and nobody else in their
-- workspace (ADR 0053). The chain is proved EXPLICITLY here rather than
-- inherited by leaning on the parent tables' own policies — `work_items`
-- against `work_lists` (drizzle/0105) is written out the same way, and for the
-- same reason: a policy whose correctness depends on a second policy in
-- another file is one refactor away from being wrong.
--
-- TWO EXISTS CLAUSES, NOT ONE, AND THEY ANSWER DIFFERENT QUESTIONS:
--
--   * the REPORT clause answers "is this thread yours" — tenant and user
--     together, the whole of the visibility rule;
--   * the MESSAGE clause answers "is the turn it arrived on one you may read",
--     which today means `internal = false`.
--
-- THE MESSAGE CLAUSE GUARDS A LEAK THAT CANNOT HAPPEN YET, on purpose. Only
-- clients upload in slice 2, so no attachment can be on an internal note. The
-- day somebody adds an operator picker — one component and one action — the
-- hole would open silently, because nothing else in the system would refuse
-- it. Closing it now costs one clause; noticing it later costs a client
-- reading a note about themselves.
--
-- ============================================================================
-- INSERT IS THE CLIENT'S OWN, AND THERE IS NO UPDATE AND NO DELETE
-- ============================================================================
--
-- `clerk_user_id = app_current_user()` on insert, so a row cannot be filed in
-- somebody else's name; the report clause stops it being filed onto somebody
-- else's thread.
--
-- No UPDATE policy: a stored file is not a thing to repoint. No DELETE policy:
-- an attachment goes when its message goes, and its message goes when the
-- report or the tenant does — by cascade, which is the `audit_log` posture the
-- rest of this family already takes. A client who attached the wrong
-- screenshot sends another one and says so; that is a conversation, and this
-- is a conversation.
--
-- THE BLOB ITSELF IS NOT PROTECTED BY ANY OF THIS. The bytes live in a private
-- Vercel Blob store and reach a browser only through
-- `/api/feedback/attachments/[id]`, which re-checks authorization on every
-- fetch before it streams. The row is what RLS guards; the route is what
-- guards the file.
--
-- tests/isolation/feedback.test.ts asserts each clause below.

ALTER TABLE "feedback_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY feedback_attachments_superadmin_all ON "feedback_attachments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());--> statement-breakpoint

CREATE POLICY feedback_attachments_own_select ON "feedback_attachments" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "feedback_reports" r
      WHERE r."id" = "feedback_attachments"."report_id"
        AND r."tenant_id" = app_current_tenant()
        AND r."clerk_user_id" = app_current_user()
    )
    AND EXISTS (
      SELECT 1 FROM "feedback_messages" m
      WHERE m."id" = "feedback_attachments"."message_id"
        AND m."tenant_id" = app_current_tenant()
        AND m."internal" = false
    )
  );--> statement-breakpoint

CREATE POLICY feedback_attachments_own_insert ON "feedback_attachments" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
    AND EXISTS (
      SELECT 1 FROM "feedback_reports" r
      WHERE r."id" = "feedback_attachments"."report_id"
        AND r."tenant_id" = app_current_tenant()
        AND r."clerk_user_id" = app_current_user()
    )
    AND EXISTS (
      SELECT 1 FROM "feedback_messages" m
      WHERE m."id" = "feedback_attachments"."message_id"
        AND m."tenant_id" = app_current_tenant()
        AND m."internal" = false
    )
  );
