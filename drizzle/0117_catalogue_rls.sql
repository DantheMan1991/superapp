-- Catalogue (products, payment_terms, payment_methods): RLS for the three new
-- tables. Pattern per drizzle/0112_bank_rules_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- No trigger and no owner-only policy on any of the three. These are reference
-- lists, not money: the invariants that matter are carried by the composite
-- foreign keys added in 0116 (a product's income account is a same-tenant
-- account; a customer's terms are same-tenant terms), and by the partial unique
-- index that allows at most one default term per tenant. Who may EDIT them is
-- an application concern, gated at the action like every other settings write —
-- RLS decides which tenant's rows exist at all, which is its job here.
--
-- `invoice_payments.method` deliberately has no FK to payment_methods, so no
-- policy interaction to reason about: deactivating a method must never change
-- what a posted payment recorded.

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY products_superadmin_all ON "products"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY products_member_all ON "products"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "payment_terms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_terms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_terms_superadmin_all ON "payment_terms"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY payment_terms_member_all ON "payment_terms"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_methods_superadmin_all ON "payment_methods"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY payment_methods_member_all ON "payment_methods"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
