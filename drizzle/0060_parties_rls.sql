-- parties — the shared identity spine. EXPAND step 2 of 3.
--
-- ORDINARY TENANT SCOPING, and the absence of anything cleverer is the point.
-- Six mail tables and the documents policy in this schema read a second GUC
-- (`app.clerk_user_id`, `app.tenant_role`) because their rows belong to a
-- PERSON or carry a visibility flag. A party does neither. Who a business deals
-- with is the business's own record, exactly as `customers` and `vendors` have
-- always been — so this is `tenant_id = app_current_tenant()` and nothing else,
-- matching 0012 (customers) and 0016 (vendors).
--
-- CRM's own per-party rows are where record visibility lands, in a later slice,
-- on a `crm_*` table with its own policy. Putting a restricted flag HERE would
-- mean an accounting-only tenant carrying a CRM concept, and would let a CRM
-- feature hide a row Accounting needs in order to render an invoice.
--
-- MEMBER WRITABLE, deliberately. Adding a customer is ordinary work and always
-- has been; this table is the identity behind that customer, so making it
-- read-only would break the create path it exists to serve.
--
-- WHY IT IS NOT `member_read` DESPITE BEING SHARED BY TWO MODULES. That is a
-- code-ownership question — `src/lib/parties/` is the single door — and not an
-- authorization one. RLS decides who may touch a ROW; it has no opinion about
-- which module's code is doing it, and encoding a review rule here would put it
-- somewhere that cannot enforce it. If the single door starts slipping, the fix
-- is a lint rule.
--
-- Safe against the running code: the table is new, so nothing already deployed
-- reads or writes it (the 0025 lesson).

ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY parties_superadmin_all ON "parties"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY parties_member_all ON "parties"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
