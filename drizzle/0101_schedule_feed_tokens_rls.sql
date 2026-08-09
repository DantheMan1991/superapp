-- Scheduling slice 5: RLS for the subscribe-feed tokens.
--
-- PER-PERSON IN BOTH DIRECTIONS, like `notification_preferences` (0090) and for
-- the same reason: a feed token is a credential to ONE person's calendar.
-- Tenant-wide scoping would let a colleague list — or revoke — somebody else's
-- subscriptions, and an OWNER is no different here. Being the boss is not a way
-- into somebody's phone.
--
-- `app_current_user()` returns NULL when unset, and `clerk_user_id = NULL` is
-- NULL rather than true, so a transaction that forgot the user id sees no
-- tokens rather than every token. A forgotten opt-in denies.
--
-- ============================================================================
-- THE ROUTE THAT SERVES THE FEED READS THIS TABLE UNDER `withSystem`, AND MUST.
-- ============================================================================
--
-- There is no session on a calendar subscription — the phone cannot log in — so
-- the request arrives with no tenant and no user, and the token is the only
-- thing that can establish either. The superadmin policy below is what lets
-- `resolveFeedToken` turn a hash into a person.
--
-- THAT IS THE ONLY THING IT MAY DO UNDER `withSystem`. The moment the person is
-- known, the route reopens as them — `withTenant(tenantId, …, { role, userId })`
-- — and every event it serves comes back through ordinary RLS. A feed that
-- selected items under the system context would hand out whatever the token
-- named, including calendars that person cannot see. See
-- src/app/api/schedule/feed/[token]/route.ts, where the two halves are kept
-- deliberately far apart.

ALTER TABLE "schedule_feed_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_feed_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY schedule_feed_tokens_superadmin_all ON "schedule_feed_tokens"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- Your own tokens, read and written. The role test is deliberately ABSENT:
-- there is no tier of membership that should reach somebody else's row.
--
-- The test is in USING as well as WITH CHECK because WITH CHECK is not
-- consulted for DELETE (0067, 0077) — without it, anybody could delete every
-- feed token in the workspace while being unable to create one, which here
-- means silently unsubscribing everybody's phone.
CREATE POLICY schedule_feed_tokens_own ON "schedule_feed_tokens"
  FOR ALL
  USING (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant()
    AND "clerk_user_id" = app_current_user()
  );
