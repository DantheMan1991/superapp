-- document_attachments: RLS. ENABLE + FORCE, superadmin_all, member_all.
--
-- **THE POLICY INHERITS THE DOCUMENT'S VISIBILITY, exactly as
-- `document_versions` does (drizzle/0024).** The tenant check alone would be a
-- leak of a specific and unhelpful kind: an owners-only photo would stay
-- unreadable, but a staff member's gallery would still count it and say "3
-- photos" over two they can see. Answering "how many things are you not showing
-- me" is not much better than showing them.
--
-- The EXISTS runs against `documents`, whose own policy already compares
-- `effective_visibility` with `app_current_tenant_role()` — so there is no third
-- copy of the visibility flag here, and none of the recomputation that would
-- have to keep it true.
--
-- There is deliberately NO check on the TARGET. This table is polymorphic on
-- purpose (see the schema comment), the target may belong to a pack that is not
-- installed, and a policy cannot join to a table it cannot name. Cross-tenant
-- safety rests on `tenant_id` and on the document FK, both of which are real.

ALTER TABLE "document_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_attachments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_attachments_superadmin_all ON "document_attachments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_attachments_member_all ON "document_attachments"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "documents" d
       WHERE d."tenant_id" = "document_attachments"."tenant_id"
         AND d."id" = "document_attachments"."document_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "documents" d
       WHERE d."tenant_id" = "document_attachments"."tenant_id"
         AND d."id" = "document_attachments"."document_id"
    )
  );
