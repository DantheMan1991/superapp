-- support_sessions: RLS. ENABLE + FORCE, superadmin_all ONLY — platform-level,
-- like interview_sessions. A support session is a superadmin looking at a
-- client's workspace as its staff see it (back-office slice 4): the console
-- opens and ends one, src/lib/auth.ts reads it. A client's members see nothing
-- of who has looked at their workspace; that they might one day is an Open
-- item in docs/modules/back-office.md, not a policy to write now.
--
-- FORCEd for the reason every table here is: the app connects as app_user,
-- and the policy is the backstop, not the application code.

ALTER TABLE "support_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_sessions_superadmin_all ON "support_sessions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
