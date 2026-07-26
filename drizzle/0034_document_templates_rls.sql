-- Document templates: RLS for the two new tables.
--
-- Safe against the running code: both tables are new, so nothing already
-- deployed reads or writes them (the 0025 lesson — migrations run against the
-- live database BEFORE the new code deploys).
--
-- Both use the ordinary member_all shape (drizzle/0014). Templates are NOT
-- visibility-bearing: a template is a blank form the business wrote, not a
-- document, so there is no owners-only dimension to inherit and no
-- app_current_tenant_role() term here. The documents a template GENERATES are
-- ordinary documents and get their visibility from the folder they land in,
-- which is the existing rule and needs nothing new.
--
-- Publish immutability — a version with published_at set is frozen — is
-- enforced in doc-templates/template-ops.ts, not here. Postgres cannot express
-- "these columns become immutable once that column is non-null" without a
-- trigger, and a trigger that silently discards a write is worse than an
-- application error that says why.

ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_templates_superadmin_all ON "document_templates"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_templates_member_all ON "document_templates"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- Versions inherit nothing and carry no flag of their own: the parent template
-- is already tenant-scoped, and an EXISTS subquery here would buy no extra
-- safety while costing a join on every read.
ALTER TABLE "document_template_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_template_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_template_versions_superadmin_all ON "document_template_versions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_template_versions_member_all ON "document_template_versions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
