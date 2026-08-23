-- The processor directory: RLS. Pattern per drizzle/0169_production_rls.sql and
-- drizzle/0185_production_run_carcasses_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all, on all three tables.
--
-- MEMBER-WIDE, like every other table in this pack, and here the reason is that
-- choosing where to send animals is a conversation the whole farm has. The
-- person who rings round for a date in October is not necessarily the owner, and
-- a directory only the owner could read would be a directory kept on paper
-- instead.
--
-- WHAT A LEAKED ROW WOULD ACTUALLY GIVE AWAY, because it is not the usual
-- answer. These tables hold one farm's negotiated PRICES — a kill fee per head
-- and a cut-and-wrap rate per pound — beside its private opinion of a plant it
-- has to keep working with. A row visible across a tenant boundary would hand
-- one farm another farm's quoted rates from the same processor, which is
-- commercially harmful in a way a leaked weight is not, and it would expose
-- `good_at` and `notes`: somebody's candid assessment of a named local business,
-- written on the assumption that nobody outside the farm would ever read it.
--
-- Cascade deletes reach the children from the processor and the processor from
-- the party, so nothing here can outlive the identity it describes and become an
-- unattributable opinion about a business nothing else in the database names.

ALTER TABLE "production_processors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_processors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_processors_superadmin_all ON "production_processors"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_processors_member_all ON "production_processors"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "production_processor_handles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_processor_handles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_processor_handles_superadmin_all ON "production_processor_handles"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_processor_handles_member_all ON "production_processor_handles"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "production_processor_cuts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_processor_cuts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_processor_cuts_superadmin_all ON "production_processor_cuts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_processor_cuts_member_all ON "production_processor_cuts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
