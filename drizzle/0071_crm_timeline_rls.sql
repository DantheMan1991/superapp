-- CRM slice 4 — activity and follow-ups.
--
-- Both tables are new, so nothing already deployed reads them (the 0025
-- lesson). Statement order needed no hand edit this time, and it is worth
-- saying why rather than leaving the next person to wonder: 0070's composite
-- FKs point at `parties` (0059) and `crm_deals` (0068), both from EARLIER
-- migrations, so the unique indexes backing them already existed. The 0068 trap
-- only bites when one migration creates both ends.
--
-- ACTIVITIES inherit the party's visibility, positively, exactly as deals do.
-- A note reading "they are refusing to pay until the dispute is settled" is at
-- least as sensitive as the record it is filed against, so it cannot be the
-- thing that stays visible when the record does not.

ALTER TABLE "crm_activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_activities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_activities_superadmin_all ON "crm_activities"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

CREATE POLICY crm_activities_member_all ON "crm_activities"
  USING (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_activities"."tenant_id"
         AND d."party_id" = "crm_activities"."party_id"
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "crm_party_details" d
       WHERE d."tenant_id" = "crm_activities"."tenant_id"
         AND d."party_id" = "crm_activities"."party_id"
    )
  );
--> statement-breakpoint

ALTER TABLE "crm_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crm_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crm_tasks_superadmin_all ON "crm_tasks"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

------------------------------------------------------------------------------
-- TASKS BRANCH, and the branch is the only genuinely new shape in this file.
--
-- `party_id` is nullable because "ring the accountant back" is a real task
-- belonging to nobody in the CRM, and a product that refuses to hold it sends
-- that task to a sticky note. So:
--
--   party_id IS NULL  → an ordinary tenant-scoped row, visible to every member
--   party_id IS SET   → inherits that record's visibility, positively
--
-- THE `IS NULL` BRANCH IS NOT A HOLE, and it is worth being explicit because a
-- reviewer's first instinct is that it should be. An unattached task names no
-- record, so there is no restricted thing for it to leak; its title is the
-- author's own words about their own work. The moment somebody attaches it to a
-- restricted record, the second branch takes over and the row disappears for
-- staff — including on UPDATE, because WITH CHECK carries the same test, so a
-- staff member cannot attach a task to a record they cannot see.
--
-- What this deliberately does NOT do is scope tasks to their assignee. A
-- follow-up is the business's work, not private correspondence; the person who
-- covers for somebody on holiday has to be able to see what is outstanding.
-- `app.clerk_user_id` exists and is used by six mail tables — its absence here
-- is a decision, not an omission.
------------------------------------------------------------------------------

CREATE POLICY crm_tasks_member_all ON "crm_tasks"
  USING (
    "tenant_id" = app_current_tenant()
    AND (
      "party_id" IS NULL
      OR EXISTS (
        SELECT 1 FROM "crm_party_details" d
         WHERE d."tenant_id" = "crm_tasks"."tenant_id"
           AND d."party_id" = "crm_tasks"."party_id"
      )
    )
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND (
      "party_id" IS NULL
      OR EXISTS (
        SELECT 1 FROM "crm_party_details" d
         WHERE d."tenant_id" = "crm_tasks"."tenant_id"
           AND d."party_id" = "crm_tasks"."party_id"
      )
    )
  );
