-- livestock_breed_parts: RLS. Pattern per drizzle/0139_livestock_rls.sql —
-- ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE at the row level, as everywhere in this pack: RLS answers "whose
-- rows are these", and which VERB needs which role is the action layer's
-- business. Stating what an animal is made of is an `owner` verb there, beside
-- the rest of editing a lot.
--
-- The composition of another farm's cattle leaking in here would not merely
-- expose data — it would be arithmetic. A pedigree fold walks parents, and a
-- parent row this tenant cannot see must not silently contribute half of an
-- animal's breeding. FORCEd for the same reason every other table in the pack
-- is: the app connects as `app_user`, and the policy is the backstop, not the
-- application code.

ALTER TABLE "livestock_breed_parts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "livestock_breed_parts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY livestock_breed_parts_superadmin_all ON "livestock_breed_parts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY livestock_breed_parts_member_all ON "livestock_breed_parts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
