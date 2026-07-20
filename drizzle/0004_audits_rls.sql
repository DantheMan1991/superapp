-- Audits hold prospect intelligence — platform-owner eyes only.
ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audits_superadmin_all ON "audits"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
