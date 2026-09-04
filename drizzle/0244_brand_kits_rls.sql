-- brand_kits: RLS. ENABLE + FORCE. Members read; OWNERS write; superadmin all.
--
-- WHAT IS IN HERE. The business's look — display name, tagline, two colours
-- and where its logo blob lives — one row for the business and optionally one
-- per company (entity_id). Layer 0 identity data, read by the invoice PDF
-- today and by every future thing that puts the business in front of a
-- customer; edited by the Marketing module.
--
-- WHY MEMBERS READ. Nothing here is private: it is what the business shows the
-- world, and whoever renders an invoice, a signature or a share page needs it
-- without a role. `src/lib/brand/read.ts` reads it under whatever role the
-- caller has, and the reminder sweep reads it as `staff`.
--
-- WHY ONLY OWNERS WRITE, AS A POLICY AND NOT ONLY AS A HABIT. How the business
-- looks is a decision (src/lib/packs/authorize.ts draws the decision/chore
-- line): the logo on every invoice is chosen by whoever owns the business.
-- The action layer refuses non-owners first; this makes the refusal hold even
-- if a future caller forgets to, the way work_lists (0105) reads the role for
-- visibility. `app_current_tenant_role()` defaults to 'staff' when no role is
-- passed, so forgetting `{ role }` DENIES a write rather than granting one.
--
-- THE DENIAL IS SILENT FOR UPDATE AND DELETE — zero rows, no error — which is
-- why kit-ops.ts treats an empty RETURNING as the refusal it is. INSERT is loud.
--
-- The composite FK (tenant_id, entity_id) → entities is in 0243 and is what
-- makes a kit naming another tenant's company unrepresentable even under
-- withSystem. tests/isolation/brand.test.ts asserts every clause here.

ALTER TABLE "brand_kits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "brand_kits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY brand_kits_superadmin_all ON "brand_kits"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY brand_kits_member_read ON "brand_kits" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint
CREATE POLICY brand_kits_owner_insert ON "brand_kits" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY brand_kits_owner_update ON "brand_kits" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint
CREATE POLICY brand_kits_owner_delete ON "brand_kits" FOR DELETE
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
