-- Documents (session 5): RLS for the two new tables. Pattern per
-- drizzle/0001_rls.sql: ENABLE + FORCE, superadmin_all, member_all.
-- No new triggers — document invariants ride the CHECK (one target),
-- partial uniques (no duplicate links), and NO ACTION composite FKs
-- (hard-delete paths must detach first; the FK is the backstop).

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_superadmin_all ON "documents"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY documents_member_all ON "documents"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "document_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_links_superadmin_all ON "document_links"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_links_member_all ON "document_links"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
