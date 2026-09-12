-- device_grants + device_grant_uses: RLS. ENABLE + FORCE on both.
--
-- THE POSTURE IS `push_devices` (0262), NOT AN ORDINARY TENANT TABLE, and for
-- a sharper version of the same reason. A grant is a CREDENTIAL: holding it
-- lets a phone write to this workspace with no session behind it. So the rule
-- is your own rows in your own tenant — `app_current_tenant()` AND
-- `app_current_user()` together — and no tier of membership reaches somebody
-- else's phone in either direction.
--
-- AN OWNER CANNOT SEE OTHER PEOPLE'S PHONES HERE, AND THAT IS A KNOWN GAP,
-- recorded as an open item in docs/modules/identity-and-roles.md rather than
-- quietly accepted. The lever an owner already has is bigger and blunter:
-- taking somebody out of the workspace deletes their `memberships` row, and
-- `redeem.ts` INNER JOINs it, so every grant that person holds stops working
-- on its next sentence. A policy is easier to loosen later than to tighten,
-- and an owner-read clause is a decision to take with a screen to put it on.
--
-- `app_current_user()` IS NULL WHEN NO USER WAS SET, and NULL = anything is
-- not true, so a caller who opened a transaction without a user sees nothing
-- rather than everything. That is the whole reason the clause is safe to lean
-- on (src/db/index.ts, drizzle/0043).
--
-- NO SUPERADMIN WRITE BEYOND `all`, and no public policy: nothing outside a
-- workspace reads either table, and the redeem path runs `withSystem` for one
-- lookup before reopening as the person — the shape `feed-serve.ts` set.
--
-- tests/isolation/device-grants.test.ts asserts each clause below.

ALTER TABLE "device_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "device_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY device_grants_superadmin_all ON "device_grants"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY device_grants_own_select ON "device_grants" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
CREATE POLICY device_grants_own_insert ON "device_grants" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
-- UPDATE covers both the revoke and the slide of `expires_at`/`last_used_at`
-- that every redeem performs. Both run as the grant's own holder.
CREATE POLICY device_grants_own_update ON "device_grants" FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
-- NO DELETE POLICY, DELIBERATELY. A grant is revoked, never removed: the row
-- is how "when did I turn that off?" has an answer, and how a revoked hash can
-- never be re-minted into a working credential. Rows leave only when the
-- tenant does, by cascade, which RLS does not police.
ALTER TABLE "device_grant_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "device_grant_uses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY device_grant_uses_superadmin_all ON "device_grant_uses"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY device_grant_uses_own_select ON "device_grant_uses" FOR SELECT
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
CREATE POLICY device_grant_uses_own_insert ON "device_grant_uses" FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
--> statement-breakpoint
-- NO UPDATE POLICY AND NO DELETE POLICY, deliberately. The row is written once
-- when the sentence is answered and never edited: what a phone did last
-- Tuesday is not a thing anybody may rewrite. RLS denies an operation no
-- policy admits, so the absence IS the rule — the same append-only posture
-- `audit_log` takes. A `USING (false)` policy would be redundant and would
-- read as if it were doing the work.
