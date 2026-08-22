-- inventory_tax_treatments: RLS. Slice 3d stage 1, ADR 0013 §A.2.
--
-- MEMBER-WIDE for reading, the same as every other table in this pack. RLS
-- answers "whose rows are these"; whether a particular person may RECORD a tax
-- decision is a write level in the pack's own layer, and it is owner-only there.
--
-- These rows are a RECORD OF A DECISION rather than a derived figure, which
-- makes a leak a different shape of bad from the usual one: another business's
-- election showing up here would not move a number today, it would silently
-- change which one moves when the report lens lands, and it would carry that
-- other business's accountant's name while doing it.
--
-- FORCE, because the app connects as `app_user`, which has no BYPASSRLS.

ALTER TABLE "inventory_tax_treatments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_tax_treatments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_tax_treatments_superadmin_all ON "inventory_tax_treatments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY inventory_tax_treatments_member_all ON "inventory_tax_treatments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
