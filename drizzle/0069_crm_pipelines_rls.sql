-- CRM slice 3 — pipelines, stages, deals, stage history, deal parties.
--
-- TWO SHAPES, AND WHICH ONE A TABLE GETS FOLLOWS FROM WHAT IT IS:
--
--   CONFIGURATION (pipelines, stages) — read by every member, written only by
--   owners. Same split and same reasoning as `crm_field_defs` in 0067: a stage
--   list is the shape every deal is measured against, not a record. Reading
--   stays open because a board cannot render its columns otherwise.
--
--   RECORDS (deals, stage events, deal parties) — they INHERIT the visibility
--   of the party the deal is with. A restricted account's pipeline is exactly
--   the thing `restricted` is for; showing staff a card reading "Acme — 40,000"
--   on a record whose notes they cannot open would leak the more sensitive half.
--
-- THE INHERITANCE IS POSITIVE, FOR THE REASON 0064 SPELLS OUT AT LENGTH. RLS
-- applies inside policy subqueries, so "hide it if the party is restricted"
-- (NOT EXISTS … visibility = 'restricted') finds nothing as staff and fails
-- OPEN. Visible only if the party's `crm_party_details` row is visible is the
-- form that works, and it never names `restricted` at all.
--
-- The chain is two links deep for stage events and deal parties: they resolve
-- through `crm_deals`, whose own policy resolves through `crm_party_details`.
-- Each link is evaluated under RLS, so a restricted party hides the deal, which
-- hides its history. No cycles — `crm_party_details` reads no other table.
--
-- A CONSEQUENCE, DELIBERATE: a deal can only exist against a party CRM has a
-- record for. `deal-ops.ts` adopts the party first, exactly as affiliations do.
--
-- All five tables are new, so nothing already deployed reads them (0025).

------------------------------------------------------------------------------
-- Configuration: crm_pipelines, crm_pipeline_stages
------------------------------------------------------------------------------

ALTER TABLE "crm_pipelines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_pipelines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_pipelines_superadmin_all ON "crm_pipelines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_pipelines_member_read ON "crm_pipelines"
  FOR SELECT USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- FOR ALL with the role test in USING, not only WITH CHECK — the 0067 lesson:
-- WITH CHECK is not consulted for DELETE.
CREATE POLICY crm_pipelines_owner_write ON "crm_pipelines"
  FOR ALL
  USING ("tenant_id" = app_current_tenant() AND app_current_tenant_role() = 'owner')
  WITH CHECK ("tenant_id" = app_current_tenant() AND app_current_tenant_role() = 'owner');
--> statement-breakpoint

ALTER TABLE "crm_pipeline_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_pipeline_stages_superadmin_all ON "crm_pipeline_stages"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_pipeline_stages_member_read ON "crm_pipeline_stages"
  FOR SELECT USING ("tenant_id" = app_current_tenant());
--> statement-breakpoint

CREATE POLICY crm_pipeline_stages_owner_write ON "crm_pipeline_stages"
  FOR ALL
  USING ("tenant_id" = app_current_tenant() AND app_current_tenant_role() = 'owner')
  WITH CHECK ("tenant_id" = app_current_tenant() AND app_current_tenant_role() = 'owner');
--> statement-breakpoint

------------------------------------------------------------------------------
-- Records: crm_deals — inherits the party's visibility.
------------------------------------------------------------------------------

ALTER TABLE "crm_deals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_deals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_deals_superadmin_all ON "crm_deals"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_deals_member_all ON "crm_deals"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_deals"."tenant_id"
         AND d."party_id" = "crm_deals"."party_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_deals"."tenant_id"
         AND d."party_id" = "crm_deals"."party_id"
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- crm_deal_stage_events — inherits through the deal.
--
-- MEMBER-WRITABLE RATHER THAN member_read, and it is worth saying why given
-- this is an append-only history. The rows are written by the same action that
-- moves the deal, inside the same transaction, under the caller's own context —
-- there is no `withSystem` writer to protect them from, so a read-only policy
-- would only mean the move could not record itself.
--
-- What keeps the history honest is that nothing in the module UPDATEs or
-- DELETEs these rows; a correction is another event. That is a code property,
-- stated here so the next person to add a "tidy up" action knows it was a
-- choice. Same standing as `audit_log` being append-only by convention.
------------------------------------------------------------------------------

ALTER TABLE "crm_deal_stage_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_deal_stage_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_deal_stage_events_superadmin_all ON "crm_deal_stage_events"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_deal_stage_events_member_all ON "crm_deal_stage_events"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_deals" x
       WHERE x."tenant_id" = "crm_deal_stage_events"."tenant_id"
         AND x."id" = "crm_deal_stage_events"."deal_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_deals" x
       WHERE x."tenant_id" = "crm_deal_stage_events"."tenant_id"
         AND x."id" = "crm_deal_stage_events"."deal_id"
    )
  );
--> statement-breakpoint

------------------------------------------------------------------------------
-- crm_deal_parties — inherits through the deal, same shape.
------------------------------------------------------------------------------

ALTER TABLE "crm_deal_parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_deal_parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_deal_parties_superadmin_all ON "crm_deal_parties"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_deal_parties_member_all ON "crm_deal_parties"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_deals" x
       WHERE x."tenant_id" = "crm_deal_parties"."tenant_id"
         AND x."id" = "crm_deal_parties"."deal_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_deals" x
       WHERE x."tenant_id" = "crm_deal_parties"."tenant_id"
         AND x."id" = "crm_deal_parties"."deal_id"
    )
  );
