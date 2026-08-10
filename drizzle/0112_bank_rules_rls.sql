-- Bank rules: RLS for the one new table. Pattern per drizzle/0010_banking_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all. No trigger: a rule is
-- suggestion-grade data, and the invariants that matter (the category is a real
-- same-tenant account, the register belongs to this tenant) are carried by the
-- composite foreign keys added in 0111.
--
-- `bank_transactions.rule_suggestion` needs no policy of its own: it is a column
-- on a table already covered by bank_transactions_member_all.

ALTER TABLE "bank_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bank_rules_superadmin_all ON "bank_rules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY bank_rules_member_all ON "bank_rules"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
