-- site_enquiries: RLS. ENABLE + FORCE. Members read; members INSERT; OWNERS
-- delete; nobody updates; superadmin all. Marketing slice 4, ADR 0021.
--
-- THE INSERT IS THE PUBLIC PATH'S. A visitor's message arrives with no
-- session; src/lib/sites/enquiries.ts turns the site's slug into a tenant
-- through the same trusted lookup the renderer uses, then writes as `staff`
-- inside that tenant's context — so the member INSERT policy below is the
-- one the form satisfies, and what the form may write is exactly what a
-- staff member could. There is no UPDATE policy at all: an enquiry is never
-- edited. Removing one is an owner's call. The composite FK (tenant_id,
-- site_id) → sites is in 0252. tests/isolation/sites.test.ts asserts each
-- clause here.

ALTER TABLE "site_enquiries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_enquiries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_enquiries_superadmin_all ON "site_enquiries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY site_enquiries_member_read ON "site_enquiries" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY site_enquiries_member_insert ON "site_enquiries" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() IN ('owner', 'staff')
  );
--> statement-breakpoint
CREATE POLICY site_enquiries_owner_delete ON "site_enquiries" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
