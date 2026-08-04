-- CRM slice 1 — the module's own tables, and the first record-level visibility
-- outside Documents.
--
-- Both are new, so nothing already deployed reads or writes them (the 0025
-- lesson). `app_current_tenant_role()` already exists from 0024; this reuses it
-- rather than inventing a second mechanism for the same idea.
--
-- WHY VISIBILITY IS IN RLS AND NOT IN AN APPLICATION QUERY LAYER. Documents
-- settled this the expensive way: `/api/accounting/documents/[id]/file` was a
-- bare id lookup with only a module gate, and until it passed `{ role }` to
-- withTenant, any staff member could stream an owners-only file by learning its
-- uuid. App-level filtering protects the surfaces somebody remembered to route
-- through it; the route that leaked was not one of them. A CRM record will
-- acquire exactly the same kind of surface — an export, a mail placeholder, a
-- webhook — so the rule goes where every path meets it.
--
-- Fail-closed as always: `app_current_tenant_role()` defaults to 'staff', the
-- least privileged value, so a caller who forgets `{ role }` is denied a
-- restricted row and can never be granted one.

ALTER TABLE "crm_party_details" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_party_details" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_party_details_superadmin_all ON "crm_party_details"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- The visibility term, in both halves.
--
-- The WITH CHECK half is not decoration: without it a staff member could mark
-- a record `restricted` and then no longer see the row they just wrote, or —
-- worse — take a restricted record and flip it back to `members`. Reading and
-- writing are gated by the same predicate for the same reason Documents gates
-- both, where it also buys "staff cannot move a document into a restricted
-- folder" for free.
--
-- NOTE `owner_clerk_user_id` PLAYS NO PART HERE. It records who a record is
-- ASSIGNED to, which is an attribution and not a grant — a rep does not get to
-- see a restricted record because their name is on it, and a colleague does not
-- lose an ordinary one because it is not. Visibility is decided by tenant role
-- alone, which keeps the two meanings of "owner" from ever touching.
------------------------------------------------------------------------------

CREATE POLICY crm_party_details_member_all ON "crm_party_details"
  USING (
    "tenant_id" = app_current_tenant()
    AND ("visibility" = 'members' OR app_current_tenant_role() = 'owner')
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND ("visibility" = 'members' OR app_current_tenant_role() = 'owner')
  );
--> statement-breakpoint

ALTER TABLE "crm_affiliations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_affiliations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_affiliations_superadmin_all ON "crm_affiliations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- Affiliations INHERIT visibility from both endpoints rather than storing a
-- third copy of the flag — the same trick `document_versions` uses, and for the
-- same reason: two copies of a visibility rule drift, and the drift is silent.
--
-- THE INHERITANCE MUST BE POSITIVE, AND THIS IS THE TRAP WORTH WRITING DOWN.
-- The obvious spelling is "hide this row if either endpoint is restricted":
--
--     NOT EXISTS (select 1 from crm_party_details d
--                  where d.party_id in (person_party_id, organization_party_id)
--                    and d.visibility = 'restricted')
--
-- That is exactly backwards, because RLS applies INSIDE policy subqueries. A
-- staff member cannot see the restricted row, so the inner query finds nothing,
-- so NOT EXISTS is TRUE, so the affiliation is shown — to precisely the person
-- it was meant to be hidden from. The negative form fails open.
--
-- Stated positively, the same mechanism works for us: the row is visible only
-- if BOTH endpoints resolve to a crm_party_details row the caller can see. A
-- restricted endpoint is invisible to staff, so the EXISTS is false, so the
-- affiliation disappears. No predicate in this policy mentions `restricted` at
-- all — it is inherited, not restated, and it cannot drift.
--
-- THE CONSEQUENCE, WHICH IS DELIBERATE: an affiliation may only exist between
-- two parties CRM has a record for. A party Accounting created and CRM has
-- never been asked about has no details row, so it cannot be affiliated until
-- it does — and CRM's own create path always writes one. That is the correct
-- direction: CRM should not be quietly building a social graph over records it
-- was never given.
--
-- No cycle: crm_party_details' own policy reads no other table.
------------------------------------------------------------------------------

CREATE POLICY crm_affiliations_member_all ON "crm_affiliations"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_affiliations"."tenant_id"
         AND d."party_id" = "crm_affiliations"."person_party_id"
    )
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_affiliations"."tenant_id"
         AND d."party_id" = "crm_affiliations"."organization_party_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_affiliations"."tenant_id"
         AND d."party_id" = "crm_affiliations"."person_party_id"
    )
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_affiliations"."tenant_id"
         AND d."party_id" = "crm_affiliations"."organization_party_id"
    )
  );
