-- Interview sessions hold prospect conversations — platform-owner eyes only.
-- No member policies: sessions belong to no tenant. The public page reaches
-- them exclusively through withSystem server code holding the session uuid.
ALTER TABLE "interview_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interview_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interview_sessions_superadmin_all ON "interview_sessions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
