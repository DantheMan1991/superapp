-- Rule health: policies.
--
-- READ AND WRITE ARE SPLIT DIFFERENTLY FROM THE RULES TABLE ITSELF, and the
-- difference is the point.
--
-- `0083` made rule WRITES owner-only because a rule changes everybody's data,
-- so creating one is the business's decision. Health is not a decision — it is
-- something that HAPPENED, observed by the engine. And the engine runs inside
-- the transaction of whoever triggered it, which is usually staff. Putting
-- these columns on the rules table would have made them unwritable exactly when
-- a rule was failing for a staff member, which is the case this feature exists
-- to catch.
--
-- So: nobody writes this from tenant context at all. The engine writes it under
-- withSystem (trusted server code, S2), which also means a member cannot forge
-- a failure against a rule they would rather nobody used.
--
-- READS are open to every member, matching `0083`'s reasoning for rules
-- themselves: somebody who finds a follow-up they did not create is owed the
-- ability to find out which rule did it, and "that rule has been failing since
-- Tuesday" is part of that answer. The rows contain no data about anybody — an
-- error message about a rule, not a record.
--
-- NOTE WHAT IS NOT HERE: no visibility term, for the same reason rules have
-- none. Health belongs to a rule, and a rule belongs to the tenant rather than
-- to any record.

ALTER TABLE "crm_automation_rule_health" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_automation_rule_health" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_automation_rule_health_superadmin_all ON "crm_automation_rule_health"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_automation_rule_health_read ON "crm_automation_rule_health"
  FOR SELECT
  USING ("tenant_id" = app_current_tenant());
