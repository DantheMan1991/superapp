-- push_devices — a phone that asked to be told (docs/modules/mobile-app.md,
-- docs/modules/notifications.md).
--
-- Keyed by PERSON, not tenant: a device belongs to whoever is signed in on it,
-- and a person in two businesses has one phone. So there is no tenant term
-- here at all — the shape is profiles', not schedule_feed_tokens'. The one rule
-- is "your own rows and nobody else's", and no tier of membership changes it:
-- an owner cannot see, disable or delete a staff member's phone, and a staff
-- member cannot register a phone as somebody else.
--
-- The test is in USING as well as WITH CHECK because WITH CHECK is not
-- consulted for DELETE (0067, 0077, 0101) — without it anybody could delete
-- every phone in the system while being unable to add one.
--
-- Registration and sending both run under withSystem (S2). Sending, because
-- it is the digest cron acting for people whose roles it has reconciled.
-- Registration, because a phone changes hands: the row for its token belongs
-- to the previous person, whom the new one may not see, and an upsert in
-- tenant context would be refused at exactly the moment it matters. The
-- server action binds the row to the verified caller and nothing else.

ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY push_devices_superadmin_all ON "push_devices"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint

-- app_current_user() is NULL when no user was set, and NULL = anything is not
-- true: forgetting the user id denies rather than widens.
CREATE POLICY push_devices_own ON "push_devices"
  FOR ALL
  USING ("clerk_user_id" = app_current_user())
  WITH CHECK ("clerk_user_id" = app_current_user());
