-- job_commitments + job_commitment_lines: RLS. Pattern per
-- drizzle/0328_job_contracts_rls.sql — ENABLE + FORCE, superadmin_all,
-- member_all. And the cost-code dimension backfill, which is not RLS but has to
-- run once and belongs with the slice that needs it.
--
-- MEMBER-WIDE at the row level, as everywhere in the packs. Issuing a purchase
-- order is an `owner` verb in the action layer — it commits the business's money
-- — while reading what has been ordered is ordinary work for anybody expecting a
-- delivery. See src/lib/packs/authorize.ts.
--
-- LINES ARE POLICIED IN THEIR OWN RIGHT, not left to inherit from the header.
-- `work_items` against `work_lists` (drizzle/0105) is written out the same way
-- and for the reason that file gives: a policy whose correctness depends on a
-- second policy in another file is one refactor away from being wrong. The
-- tenant column is on the line, so the clause is the simple one.

ALTER TABLE "job_commitments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_commitments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_commitments_superadmin_all ON "job_commitments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_commitments_member_all ON "job_commitments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_commitment_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_commitment_lines_superadmin_all ON "job_commitment_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_commitment_lines_member_all ON "job_commitment_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ============================================================================
-- EVERY COST CODE BECOMES A COST OBJECT
-- ============================================================================
--
-- From this slice a cost code is a `dimension_members` row, so a bill line can
-- be charged to one and every accounting report can group by it. That needs no
-- change in accounting at all: the bill builder derives the types it offers from
-- whatever members exist (`dimensionTypesFrom`), so the codes simply appear.
--
-- `createCostCode` and `updateCostCode` sync from here on. THIS backfills the
-- codes that already exist, because a chart where some lines are taggable and
-- others silently are not is worse than one where none are — and the difference
-- would only show up as a bill somebody could not code.
--
-- Idempotent by the unique key on (tenant_id, dimension_type, pack_entity_id),
-- so re-running changes nothing. Matches the display name
-- `src/packs/jobs/ops.ts` builds: "code · name".

INSERT INTO "dimension_members" ("tenant_id", "dimension_type", "pack_entity_id", "display_name", "is_active")
SELECT c."tenant_id", 'cost_code', c."id", c."code" || ' · ' || c."name", c."is_active"
FROM "job_cost_codes" c
ON CONFLICT ("tenant_id", "dimension_type", "pack_entity_id") DO NOTHING;
