-- party_contact_points — how to reach a party.
--
-- ORDINARY TENANT SCOPING, matching `parties` (0060) rather than any of the
-- visibility-bearing shapes, and the reasoning is worth stating because a
-- reviewer's instinct is that an email address deserves more.
--
-- It is not MORE protected than the identity it hangs off. The same addresses
-- already sit on `customers.email` and `vendors.email`, which every member can
-- read and which this table is backfilled FROM — so a policy that hid contact
-- points from staff would hide one copy of a fact while the other stayed in
-- plain view on the invoice screen. Two answers to one question is worse than
-- either answer.
--
-- Nor is it a CRM table. `parties` is shared, and Accounting writes contact
-- points through the same door when a customer's email changes; a CRM-shaped
-- policy here would break invoicing for a tenant who never bought CRM. What
-- CRM knows about a party lives in `crm_party_details` and carries the
-- visibility flag; how to reach them does not.
--
-- MEMBER WRITABLE. Correcting a typo in a customer's email is ordinary work.
--
-- Safe against the running code: the table is new, so nothing already deployed
-- reads or writes it (the 0025 lesson).

ALTER TABLE "party_contact_points" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "party_contact_points" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY party_contact_points_superadmin_all ON "party_contact_points"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY party_contact_points_member_all ON "party_contact_points"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
