-- job_assembly_keys: RLS. Pattern per docs/security.md — the superadmin
-- policy for the god view, the member policy for the tenant's own rows.
-- The table is the join between what the model calls a thing and the
-- assembly the business means by it (X15, ADR 0107).
ALTER TABLE "job_assembly_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_assembly_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_assembly_keys_superadmin_all ON "job_assembly_keys"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_assembly_keys_member_all ON "job_assembly_keys"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
