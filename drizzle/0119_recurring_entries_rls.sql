-- recurring_entries: RLS for the one new table. Pattern per
-- drizzle/0112_bank_rules_rls.sql — ENABLE + FORCE, superadmin_all, member_all.
--
-- No trigger. What must be true of a row is already carried by the table
-- itself: the composite FK proves a bill template's vendor is a same-tenant
-- vendor, and the two CHECKs prove the shape matches the kind (a bill has a
-- vendor, a journal has none; only a journal may auto-post). The template's
-- own contents are zod-validated at write AND re-validated at generation,
-- because accounts and vendors may deactivate between the two.
--
-- Note what RLS does NOT decide here: whether a generated journal POSTS. That
-- is `auto_post` plus the period lock, enforced in the generation engine, and
-- a closed period leaves a draft rather than refusing the run.

ALTER TABLE "recurring_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_entries_superadmin_all ON "recurring_entries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY recurring_entries_member_all ON "recurring_entries"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
