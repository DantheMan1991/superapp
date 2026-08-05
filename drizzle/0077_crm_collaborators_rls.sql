-- Explicit collaborators: policies for the new table, and the one change to
-- `crm_party_details` that makes a grant mean anything.
--
-- ============================================================================
-- THIS SPENDS 0064'S PROMISE THAT "crm_party_details' OWN POLICY READS NO OTHER
-- TABLE", AND IT CAN ONLY BE SPENT ONCE.
-- ============================================================================
--
-- The details policy now reads `crm_record_collaborators`. That is safe in one
-- direction only: **the collaborators policy must never read
-- `crm_party_details`**. Postgres evaluates policies inside policy subqueries,
-- so two tables whose policies name each other recurse — the error is
-- `infinite recursion detected in policy for relation`, it fires on the first
-- SELECT, and it takes the whole module down rather than leaking anything.
-- Loud, but total.
--
-- So the collaborators policy below is deliberately SELF-CONTAINED: it consults
-- `app_current_tenant()`, `app_current_tenant_role()` and `app_current_user()`
-- and nothing else. If a future slice wants collaborator rows to inherit record
-- visibility "properly", the answer is a SECURITY DEFINER helper, not an EXISTS
-- against the details table.
--
-- WHY A GRANT IS NOT AN ASSIGNMENT. `crm_party_details.owner_clerk_user_id`
-- still plays no part in visibility, exactly as 0064 insisted. A rep's name
-- lands on a record for a dozen reasons and none of them is a decision about
-- confidentiality; a row in `crm_record_collaborators` is that decision, made
-- once, by an owner, and recorded with who made it.
--
-- WHAT INHERITS THIS FOR FREE, which is the whole reason the term goes on the
-- details policy rather than being repeated: `crm_affiliations`, `crm_deals`,
-- `crm_activities` and `crm_tasks` all resolve visibility through a positive
-- EXISTS against `crm_party_details`. A collaborator who can now see the
-- details row can therefore see that record's connections, deals, timeline and
-- follow-ups, and not one of those four policies changes. Two copies of a
-- visibility rule drift; this is the arrangement that stops there being two.

ALTER TABLE "crm_record_collaborators" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_record_collaborators" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_record_collaborators_superadmin_all ON "crm_record_collaborators"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- READ: owners see every grant in the tenant; everybody else sees only their
-- OWN.
--
-- The narrow read is not politeness, it is the same anti-probe property the
-- rest of this module has. A staff member who could list grants could ask
-- "which records have collaborators?" and get back precisely the set of
-- confidential records, which is the question `restricted` exists to refuse —
-- and the dossier already records that a restricted record and a never-worked
-- one must look identical to staff.
--
-- Seeing your own grant is deliberate and useful: it is what lets a
-- collaborator be told WHY they can see a record.
------------------------------------------------------------------------------

CREATE POLICY crm_record_collaborators_read ON "crm_record_collaborators"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      app_current_tenant_role() = 'owner'
      OR "clerk_user_id" = app_current_user()
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- WRITE: owners only, and the ROLE TEST IS IN `USING` AS WELL AS `WITH CHECK`.
--
-- Same trap `crm_field_defs` documents in 0067: **WITH CHECK is not consulted
-- for DELETE**. A single FOR ALL policy with a permissive USING and the role
-- test only in WITH CHECK would let a staff member DELETE every grant in the
-- tenant while being unable to create one — which here means silently revoking
-- access to confidential records. There is a test that deletes as staff and
-- asserts zero rows.
--
-- A COLLABORATOR CANNOT ADD A COLLABORATOR. The grant is read-only to the
-- person holding it, so access cannot spread sideways without an owner.
------------------------------------------------------------------------------

CREATE POLICY crm_record_collaborators_write ON "crm_record_collaborators"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND app_current_tenant_role() = 'owner'
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- And the change that makes a grant mean something.
--
-- The collaborator term is spelled with BOTH `party_id` and
-- `clerk_user_id = app_current_user()` in its own WHERE clause, rather than
-- leaning on the read policy above to narrow it. Belt and braces: if somebody
-- later widens who may read a grant, this term keeps saying exactly what it
-- means today, which is "a grant to ME on THIS record".
--
-- `app_current_user()` returns NULL when unset, and `clerk_user_id = NULL` is
-- NULL rather than true — so a transaction that forgot to pass a user id sees
-- no grants and falls back to owner-only. A forgotten opt-in denies. That is
-- the same fail-closed direction `app.tenant_role` was built with, and it is
-- why `withCrm()` in the module now passes both rather than leaving 49 call
-- sites to remember.
--
-- IN `WITH CHECK` TOO, so a collaborator may edit what they can see — the same
-- read/write symmetry an ordinary member has on an ordinary record. A
-- collaborator is somebody working the record, not somebody watching it.
------------------------------------------------------------------------------

DROP POLICY crm_party_details_member_all ON "crm_party_details";
--> statement-breakpoint

CREATE POLICY crm_party_details_member_all ON "crm_party_details"
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      "visibility" = 'members'
      OR app_current_tenant_role() = 'owner'
      OR EXISTS (
        SELECT 1 FROM "crm_record_collaborators" c
         WHERE c."tenant_id" = "crm_party_details"."tenant_id"
           AND c."party_id" = "crm_party_details"."party_id"
           AND c."clerk_user_id" = app_current_user()
      )
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND (
      "visibility" = 'members'
      OR app_current_tenant_role() = 'owner'
      OR EXISTS (
        SELECT 1 FROM "crm_record_collaborators" c
         WHERE c."tenant_id" = "crm_party_details"."tenant_id"
           AND c."party_id" = "crm_party_details"."party_id"
           AND c."clerk_user_id" = app_current_user()
      )
    )
  );
