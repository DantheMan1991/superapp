-- livestock_treatments: RLS. Pattern per drizzle/0139_livestock_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE, and this is the least negotiable one in the pack. The person with
-- the syringe is the person who knows what went in and when; a treatment
-- recorded three days later by somebody who was not there is how a withdrawal
-- period ends up counted from the wrong date. RLS answers "whose rows are
-- these"; which verb needs which role is the pack's action layer, and
-- `recordTreatment` is a `member` verb on purpose.
--
-- THESE ROWS DECIDE WHETHER MEAT AND MILK CAN LAWFULLY BE SOLD. Cross-tenant
-- leakage would not merely expose data: another farm's treatment appearing here
-- would put this farm's animals under a withdrawal that does not apply, and —
-- far worse in the other direction — a treatment of ours failing to appear would
-- read as clear. Both policies are FORCEd for that reason.

ALTER TABLE "livestock_treatments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_treatments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_treatments_superadmin_all ON "livestock_treatments"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_treatments_member_all ON "livestock_treatments"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
