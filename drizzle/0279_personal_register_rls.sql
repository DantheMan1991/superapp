-- A PERSONAL register (ADR 0034) is the owner's own account with some of the
-- business's money running through it. Its rows are the owner's groceries and
-- medical bills as well as the feed store, so they are visible to OWNERS AND
-- THE ACCOUNTANT ONLY — never to staff. The accountant is included because the
-- register exists to be sorted, and sorting a client's mixed account is the
-- bookkeeper's job; staff are excluded because an employee has no business
-- with the owner's personal spending.
--
-- THREE POLICIES REPLACE THREE `member_all` POLICIES, each keeping its name so
-- `pg_policies` reads the same and `verify-rls` finds the same count.
--
--  1. `bank_accounts`: the kind decides. `"kind"::text` rather than the enum
--     literal, deliberately — 'personal' was added to the enum in 0278 and a
--     migration runner that wraps both files in one transaction would trip
--     "unsafe use of new value" on the enum comparison. Text compares fine.
--  2. `bank_transactions`: INHERITS from its register through an EXISTS, the
--     same device documents' versions use (0024). RLS applies inside the
--     subquery, so a register the caller cannot see yields no rows, and
--     there is no second copy of the rule to drift.
--  3. `bank_rules`: a rule scoped to one register inherits that register's
--     visibility the same way; a rule for every register stays member-wide.
--
-- `app_current_tenant_role()` (0024) defaults to 'staff' when the caller set
-- no role — so every path that reads a personal register has to pass one, and
-- `src/modules/accounting/banking/actions.ts` does it through `inTenant`. An
-- owner path that forgets reads an empty register rather than a wrong one.

DROP POLICY IF EXISTS bank_accounts_member_all ON "bank_accounts";
--> statement-breakpoint
CREATE POLICY bank_accounts_member_all ON "bank_accounts"
  USING (
    "tenant_id" = app_current_tenant()
    AND ("kind"::text <> 'personal' OR app_current_tenant_role() IN ('owner', 'expert'))
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND ("kind"::text <> 'personal' OR app_current_tenant_role() IN ('owner', 'expert'))
  );
--> statement-breakpoint

DROP POLICY IF EXISTS bank_transactions_member_all ON "bank_transactions";
--> statement-breakpoint
CREATE POLICY bank_transactions_member_all ON "bank_transactions"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "bank_accounts" b
      WHERE b."tenant_id" = "bank_transactions"."tenant_id"
        AND b."id" = "bank_transactions"."bank_account_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "bank_accounts" b
      WHERE b."tenant_id" = "bank_transactions"."tenant_id"
        AND b."id" = "bank_transactions"."bank_account_id"
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS bank_rules_member_all ON "bank_rules";
--> statement-breakpoint
CREATE POLICY bank_rules_member_all ON "bank_rules"
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      "bank_account_id" IS NULL
      OR EXISTS (
        SELECT 1 FROM "bank_accounts" b
        WHERE b."tenant_id" = "bank_rules"."tenant_id"
          AND b."id" = "bank_rules"."bank_account_id"
      )
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND (
      "bank_account_id" IS NULL
      OR EXISTS (
        SELECT 1 FROM "bank_accounts" b
        WHERE b."tenant_id" = "bank_rules"."tenant_id"
          AND b."id" = "bank_rules"."bank_account_id"
      )
    )
  );
