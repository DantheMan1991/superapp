-- Automation rules: policies.
--
-- THE READ/WRITE SPLIT IS WIDER THAN IT LOOKS, AND THE ASYMMETRY IS THE POINT.
--
-- Writes are OWNER-ONLY, matching the merge tool and the collaborator grants: a
-- rule changes everybody's data on every trigger, so creating one is the
-- business's decision rather than a personal preference.
--
-- Reads are open to EVERY MEMBER, which is wider than either of those two. The
-- reason is transparency rather than convenience: somebody who finds a
-- follow-up they did not create, or a record whose stage changed while they
-- were not looking, is owed the ability to find out which rule did it. A rules
-- engine nobody can inspect is indistinguishable from a haunted database, and
-- the rows here contain no data about anybody — a rule is an instruction, not a
-- record.
--
-- NOTE WHAT IS *NOT* HERE: no visibility term. Rules do not belong to records,
-- so there is nothing for one to inherit. What a rule can TOUCH is decided
-- entirely by the transaction it runs in, which is the person's own — see the
-- header of `core/automation.ts`.

ALTER TABLE "crm_automation_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_automation_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_automation_rules_superadmin_all ON "crm_automation_rules"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_automation_rules_read ON "crm_automation_rules"
  FOR SELECT
  USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

------------------------------------------------------------------------------
-- WRITE: owners, with the role test in USING as well as WITH CHECK.
--
-- 0067's trap, and here it would be the worst version of itself: a single
-- FOR ALL policy with a permissive USING and the role test only in WITH CHECK
-- would let any staff member DELETE every automation in the tenant. Nothing
-- would break, no error would appear, and the business would simply stop having
-- the automations it thought it had — which is the kind of failure discovered
-- weeks later by somebody wondering why the follow-ups stopped.
--
-- There is a test that deletes as staff and asserts zero rows.
------------------------------------------------------------------------------

CREATE POLICY crm_automation_rules_owner_write ON "crm_automation_rules"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
