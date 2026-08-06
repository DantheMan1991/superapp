-- Notifications prerequisite 1: make memberships.role trustworthy enough for a
-- background job to act on.
--
-- 0018 gave tenant context a blanket UPDATE on memberships so the owner could
-- set the accountant ("expert") flag. That policy constrains only the TENANT,
-- not the value: any withTenant transaction could write role = 'owner', or
-- rewrite an existing owner row. That was inert while nothing read the column
-- for authorization — requireTenant takes owner-ness from Clerk and only ever
-- consults this table for expert-vs-staff.
--
-- It stops being inert the moment a cron reads role = 'owner' to decide whose
-- behalf it may act on: the column becomes a capability, and its only guard is
-- app code remembering to call requireTenantOwner. Column-level GRANTs cannot
-- help here — withSystem connects as the same app_user and merely sets a GUC,
-- so RLS is the only thing that can tell the Clerk webhook apart from a member.
--
-- So: narrow it. USING sees the OLD row, WITH CHECK the NEW one.
--   - USING  role <> 'owner'            → tenant context cannot touch an owner row
--   - CHECK  role IN ('staff','expert') → tenant context cannot mint one
-- Net effect: 'owner' is a value only withSystem can write — the signature-
-- verified Clerk webhook, membership-sync's server→Clerk reconcile, and seeds.
--
-- No-op for the only caller: setMemberAccountantAction already refuses owner
-- rows in app code and only ever writes 'expert' or 'staff'. The app-layer
-- check stays; this makes the database agree rather than replacing it.

DROP POLICY IF EXISTS memberships_member_update ON "memberships";
--> statement-breakpoint
CREATE POLICY memberships_member_update ON "memberships" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND "role" <> 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "role" IN ('staff', 'expert')
  );
