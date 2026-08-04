-- crm_field_defs — per-tenant custom field definitions.
--
-- THE SPLIT: EVERY MEMBER READS, ONLY OWNERS WRITE. A field definition is not a
-- record, it is the SHAPE of every record — adding a required field changes
-- what a stage transition demands of the whole tenant, and archiving one takes
-- a column off everybody's form. That is an administrative act, and it sits
-- with the same role that already owns folder structure in Documents.
--
-- Reading has to stay open to staff, because the record form cannot render
-- without the definitions. A staff member who could not read this table would
-- see a record with a `custom` blob and no way to interpret it.
--
-- TWO POLICIES RATHER THAN ONE, AND THE REASON IS DELETE.
--
-- The tempting shape is a single FOR ALL policy with a permissive USING and a
-- restrictive WITH CHECK:
--
--     FOR ALL USING (tenant_id = app_current_tenant())
--             WITH CHECK (tenant_id = app_current_tenant() AND role = 'owner')
--
-- That is wrong, and the hole is silent. **WITH CHECK is not consulted for
-- DELETE** — only USING is — so a staff member could delete every field
-- definition in the tenant while being unable to create one. The read policy is
-- therefore scoped `FOR SELECT`, and everything that mutates goes through a
-- separate `FOR ALL` policy whose USING clause carries the role test.
--
-- Postgres ORs permissive policies together, so an owner satisfies the read
-- through either one and staff satisfy only the SELECT.
--
-- Fail-closed as everywhere else: `app_current_tenant_role()` defaults to
-- 'staff', so a caller who forgets `{ role }` loses the ability to WRITE and
-- never gains it.
--
-- Safe against the running code: the table is new (the 0025 lesson).

ALTER TABLE "crm_field_defs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_field_defs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_field_defs_superadmin_all ON "crm_field_defs"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_field_defs_member_read ON "crm_field_defs"
  FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

CREATE POLICY crm_field_defs_owner_write ON "crm_field_defs"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
