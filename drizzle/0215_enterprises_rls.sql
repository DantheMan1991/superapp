-- enterprises: RLS. ENABLE + FORCE, superadmin_all + member_all — the same
-- posture as `land_parcels` (drizzle/0133) and `assets` (drizzle/0126).
--
-- MEMBER-WIDE READ AND WRITE AT THE DATABASE, OWNER-ONLY AT THE ACTION LAYER,
-- which is the division of labour those two tables already established: the
-- database decides WHOSE rows exist at all, the application decides who may
-- change them. Writing an enterprise syncs a `dimension_members` row, and
-- `upsertDimensionMember` calls `requireOwnerRole` — so a staff write cannot
-- get past `src/lib/enterprises/` even though this policy would let the row
-- through. Duplicating that check in SQL would put the rule in two places and
-- make one of them the stale one.
--
-- STAFF CAN READ, and that is not incidental. The enterprise is what the
-- inventory filter bar is built on: "just the broiler things" is a question
-- whoever is sent to the freezer asks, and at 10× that person is not the owner.
-- A list only the owner could see is a filter nobody can use.
--
-- NOT the `document_folders` arrangement, where visibility itself varies by
-- role and the policy therefore has to reach `app_tenant_role()`. An enterprise
-- has no owners-only subset — every enterprise a business runs is visible to
-- everyone who works there — so borrowing that machinery would be cost with no
-- reason behind it.
--
-- WHAT CROSS-TENANT LEAKAGE WOULD COST HERE is smaller than for a bank account
-- and larger than it looks: an enterprise is about to become a reporting
-- dimension on journal lines, so another tenant's row appearing in a picker is
-- a neighbour's line of business showing up in this farm's profit and loss.
-- The composite unique on (tenant_id, id) is what lets every pack's FK be
-- composite, which makes that shape unrepresentable even under `withSystem`;
-- this policy is the layer above it.

ALTER TABLE "enterprises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "enterprises" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY enterprises_superadmin_all ON "enterprises"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY enterprises_member_all ON "enterprises"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
