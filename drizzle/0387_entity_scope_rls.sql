-- WHICH COMPANY'S ROWS A PERSON MAY READ (ADR 0094).
--
-- The other half of ADR 0093. That one decides which SCREENS somebody may
-- open, in application code, because Reports and a bill's detail page read the
-- same journal_lines and no gate can tell those rows apart. THIS half is about
-- rows, which is the half Postgres can actually answer — and the half where a
-- leak is money.
--
-- ── EVERY POLICY HERE IS `AS RESTRICTIVE`, AND NOTHING EXISTING IS TOUCHED ───
--
-- Permissive policies are OR'd together; restrictive ones are AND'd with the
-- result. So each table gains ONE new policy and keeps every policy it already
-- had, exactly as written. That is not tidiness: these 48 tables carry policies
-- of several shapes — owners-only document folders, per-user mail scoping, the
-- register-scoped bank rules — and rewriting them by hand is precisely how an
-- existing restriction gets dropped by accident. An additive clause cannot
-- loosen anything; the worst it can do is hide too much, which is visible.
--
-- ── A RESTRICTIVE POLICY APPLIES TO THE SUPERADMIN TOO ──────────────────────
--
-- Which would break every webhook, cron, seed and migration that runs under
-- withSystem. `app_entity_allows()` therefore starts with app_is_superadmin().
-- Leaving that out is the single easiest way to take this platform down.
--
-- ── THE SCOPE IS COMPUTED ONCE PER TRANSACTION, NOT ONCE PER ROW ────────────
--
-- withTenant's context statement gained a sixth set_config that calls
-- app_entity_ids_for(tenant, acting_user) — so the lookup happens once, in a
-- statement that was already being issued, and the 6-round-trips-to-3
-- optimisation in src/db/index.ts is preserved. The per-row predicate then only
-- parses a GUC, which is string work.
--
-- ── EMPTY MEANS EVERY COMPANY ───────────────────────────────────────────────
--
-- Every membership that exists today has an empty list and keeps the access it
-- has. An owner narrows it deliberately. The same direction access levels take,
-- and the reason this can ship into a live workspace at all.

-- ────────────────────────────────────────────────────────────────────────────
-- The functions
-- ────────────────────────────────────────────────────────────────────────────

-- SECURITY DEFINER because it reads `memberships` and `profiles`, which are
-- themselves under RLS — and because it is called while establishing the very
-- context those policies read. Arguments are passed explicitly rather than
-- taken from GUCs: it runs INSIDE the set_config statement, where the order in
-- which a SELECT list is evaluated is not something to depend on.
--
-- An empty p_user matches no profile and yields '', which reads as
-- unrestricted. That is what a seed, a script, a cron and the isolation suite
-- have always had, and must keep.
CREATE OR REPLACE FUNCTION app_entity_ids_for(p_tenant uuid, p_user text)
RETURNS text AS $$
  SELECT coalesce(
    (SELECT array_to_string(m.entity_ids, ',')
       FROM memberships m
       JOIN profiles p ON p.id = m.profile_id
      WHERE m.tenant_id = p_tenant
        AND p.clerk_user_id = p_user
      LIMIT 1),
    '');
$$ LANGUAGE sql STABLE SECURITY DEFINER;
--> statement-breakpoint

-- NULL = no restriction. Deliberately not an empty array: `x = ANY('{}')` is
-- false for every x, so confusing the two would hide every row in the database.
CREATE OR REPLACE FUNCTION app_entity_scope() RETURNS uuid[] AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.entity_ids', true), '') = '' THEN NULL::uuid[]
    ELSE string_to_array(current_setting('app.entity_ids', true), ',')::uuid[]
  END;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- The predicate every policy below calls.
--
-- `p_entity IS NULL` is allowed on purpose: a row that names no company cannot
-- belong to one somebody is shut out of, and denying it would hide records that
-- predate the column or legitimately have none.
--
-- ── THE ORDER OF THESE FOUR CLAUSES IS A PERFORMANCE DECISION ───────────────
--
-- Postgres INLINES a STABLE sql function, so whatever this body says appears
-- verbatim in the plan of every table it guards — and an `app_entity_scope()`
-- mentioned twice was inlined as the full `string_to_array(...)` FOUR TIMES per
-- row, once for each place the planner expanded it. Measured on the real plan,
-- not guessed.
--
-- The second clause fixes that for everybody who is not restricted, which is
-- almost every request ever made: it is a `current_setting` and a string
-- compare, OR short-circuits, and the array is never built. The parse only
-- happens for a person who actually has a company list.
CREATE OR REPLACE FUNCTION app_entity_allows(p_entity uuid) RETURNS boolean AS $$
  SELECT app_is_superadmin()
      OR coalesce(current_setting('app.entity_ids', true), '') = ''
      OR p_entity IS NULL
      OR p_entity = ANY(app_entity_scope());
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- The company list itself
-- ────────────────────────────────────────────────────────────────────────────
--
-- A restricted person does not see companies they have no access to — in the
-- picker, in a report footer, or anywhere else. Scoped on `id` rather than an
-- `entity_id`, which is why it is written out rather than generated with the
-- rest.
CREATE POLICY entities_entity_scope ON "entities" AS RESTRICTIVE
  USING (app_entity_allows("id"))
  WITH CHECK (app_entity_allows("id"));
--> statement-breakpoint
-- ────────────────────────────────────────────────────────────────────────────
-- Tables that carry a company directly
-- ────────────────────────────────────────────────────────────────────────────
-- assets: the fixed asset register
CREATE POLICY assets_entity_scope ON "assets" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- bank_accounts: registers, and everything hanging off one below
CREATE POLICY bank_accounts_entity_scope ON "bank_accounts" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY bills_entity_scope ON "bills" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- brand_kits: how one company presents itself
CREATE POLICY brand_kits_entity_scope ON "brand_kits" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY credit_memos_entity_scope ON "credit_memos" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY deposits_entity_scope ON "deposits" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- document_attachments: a file pinned to one company's record
CREATE POLICY document_attachments_entity_scope ON "document_attachments" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY invoices_entity_scope ON "invoices" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY job_bonding_lines_entity_scope ON "job_bonding_lines" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- job_projects: and fourteen job_* tables inherit through it
CREATE POLICY job_projects_entity_scope ON "job_projects" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY job_wip_periods_entity_scope ON "job_wip_periods" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- journal_entries: the books themselves
CREATE POLICY journal_entries_entity_scope ON "journal_entries" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- mail_links: a message filed against one company's record
CREATE POLICY mail_links_entity_scope ON "mail_links" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
-- payment_accounts: the connected account, which is per company by ADR 0015
CREATE POLICY payment_accounts_entity_scope ON "payment_accounts" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY period_closes_entity_scope ON "period_closes" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY schedule_item_links_entity_scope ON "schedule_item_links" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint
CREATE POLICY work_item_links_entity_scope ON "work_item_links" AS RESTRICTIVE
  USING (app_entity_allows("entity_id"))
  WITH CHECK (app_entity_allows("entity_id"));
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- Tables that inherit a company through their parent
-- ────────────────────────────────────────────────────────────────────────────
--
-- **A NULL PARENT IS ALLOWED, NOT DENIED**, and that direction is deliberate:
-- an EXISTS that simply returned false for an orphan row would hide records
-- from EVERYBODY the moment one appeared, which is a product outage rather
-- than a leak. A row with no parent names no company.
CREATE POLICY asset_maintenance_events_entity_scope ON "asset_maintenance_events" AS RESTRICTIVE
  USING (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_maintenance_events"."asset_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_maintenance_events"."asset_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY asset_maintenance_schedules_entity_scope ON "asset_maintenance_schedules" AS RESTRICTIVE
  USING (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_maintenance_schedules"."asset_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_maintenance_schedules"."asset_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY asset_meter_readings_entity_scope ON "asset_meter_readings" AS RESTRICTIVE
  USING (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_meter_readings"."asset_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "asset_meter_readings"."asset_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY bank_rules_entity_scope ON "bank_rules" AS RESTRICTIVE
  USING (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "bank_rules"."bank_account_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "bank_rules"."bank_account_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY bank_transactions_entity_scope ON "bank_transactions" AS RESTRICTIVE
  USING (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "bank_transactions"."bank_account_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "bank_transactions"."bank_account_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY bill_lines_entity_scope ON "bill_lines" AS RESTRICTIVE
  USING (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "bill_lines"."bill_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "bill_lines"."bill_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY bill_payments_entity_scope ON "bill_payments" AS RESTRICTIVE
  USING (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "bill_payments"."bill_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "bill_payments"."bill_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY document_links_entity_scope ON "document_links" AS RESTRICTIVE
  USING (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "document_links"."invoice_id"
        AND app_entity_allows(p.entity_id)))
    AND ("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "document_links"."bill_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "document_links"."invoice_id"
        AND app_entity_allows(p.entity_id)))
    AND ("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "document_links"."bill_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY invoice_lines_entity_scope ON "invoice_lines" AS RESTRICTIVE
  USING (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "invoice_lines"."invoice_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "invoice_lines"."invoice_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY invoice_payments_entity_scope ON "invoice_payments" AS RESTRICTIVE
  USING (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "invoice_payments"."invoice_id"
        AND app_entity_allows(p.entity_id)))
    AND ("deposit_id" IS NULL OR EXISTS (
     SELECT 1 FROM deposits p WHERE p.id = "invoice_payments"."deposit_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "invoice_payments"."invoice_id"
        AND app_entity_allows(p.entity_id)))
    AND ("deposit_id" IS NULL OR EXISTS (
     SELECT 1 FROM deposits p WHERE p.id = "invoice_payments"."deposit_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_bonds_entity_scope ON "job_bonds" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_bonds"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_bonds"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_budget_lines_entity_scope ON "job_budget_lines" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_budget_lines"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_budget_lines"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_commitments_entity_scope ON "job_commitments" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_commitments"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_commitments"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_contracts_entity_scope ON "job_contracts" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_contracts"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_contracts"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_daily_logs_entity_scope ON "job_daily_logs" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_daily_logs"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_daily_logs"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_drawing_sets_entity_scope ON "job_drawing_sets" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_drawing_sets"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_drawing_sets"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_estimates_entity_scope ON "job_estimates" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_estimates"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_estimates"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_lien_waivers_entity_scope ON "job_lien_waivers" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_lien_waivers"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_lien_waivers"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_pay_applications_entity_scope ON "job_pay_applications" AS RESTRICTIVE
  USING (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "job_pay_applications"."invoice_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "job_pay_applications"."invoice_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_phases_entity_scope ON "job_phases" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_phases"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_phases"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_selections_entity_scope ON "job_selections" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_selections"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_selections"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_sheet_markups_entity_scope ON "job_sheet_markups" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_sheet_markups"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_sheet_markups"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_sheets_entity_scope ON "job_sheets" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_sheets"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_sheets"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_sub_applications_entity_scope ON "job_sub_applications" AS RESTRICTIVE
  USING (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "job_sub_applications"."bill_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bill_id" IS NULL OR EXISTS (
     SELECT 1 FROM bills p WHERE p.id = "job_sub_applications"."bill_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_warranty_claims_entity_scope ON "job_warranty_claims" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_warranty_claims"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_warranty_claims"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY job_wip_lines_entity_scope ON "job_wip_lines" AS RESTRICTIVE
  USING (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_wip_lines"."project_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("project_id" IS NULL OR EXISTS (
     SELECT 1 FROM job_projects p WHERE p.id = "job_wip_lines"."project_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY journal_lines_entity_scope ON "journal_lines" AS RESTRICTIVE
  USING (("entry_id" IS NULL OR EXISTS (
     SELECT 1 FROM journal_entries p WHERE p.id = "journal_lines"."entry_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("entry_id" IS NULL OR EXISTS (
     SELECT 1 FROM journal_entries p WHERE p.id = "journal_lines"."entry_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY livestock_capital_transfers_entity_scope ON "livestock_capital_transfers" AS RESTRICTIVE
  USING (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "livestock_capital_transfers"."asset_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("asset_id" IS NULL OR EXISTS (
     SELECT 1 FROM assets p WHERE p.id = "livestock_capital_transfers"."asset_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY operator_postings_entity_scope ON "operator_postings" AS RESTRICTIVE
  USING (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "operator_postings"."invoice_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("invoice_id" IS NULL OR EXISTS (
     SELECT 1 FROM invoices p WHERE p.id = "operator_postings"."invoice_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY reconciliations_entity_scope ON "reconciliations" AS RESTRICTIVE
  USING (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "reconciliations"."bank_account_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("bank_account_id" IS NULL OR EXISTS (
     SELECT 1 FROM bank_accounts p WHERE p.id = "reconciliations"."bank_account_id"
        AND app_entity_allows(p.entity_id))));
--> statement-breakpoint
CREATE POLICY time_entry_dimensions_entity_scope ON "time_entry_dimensions" AS RESTRICTIVE
  USING (("entry_id" IS NULL OR EXISTS (
     SELECT 1 FROM journal_entries p WHERE p.id = "time_entry_dimensions"."entry_id"
        AND app_entity_allows(p.entity_id))))
  WITH CHECK (("entry_id" IS NULL OR EXISTS (
     SELECT 1 FROM journal_entries p WHERE p.id = "time_entry_dimensions"."entry_id"
        AND app_entity_allows(p.entity_id))));
