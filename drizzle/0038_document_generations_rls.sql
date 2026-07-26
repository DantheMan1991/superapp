-- document_generations — RLS.
--
-- member_read ONLY, like document_share_events and for the same reason: this
-- is the record of what the business produced and sent, and a member who could
-- write it could fabricate or erase the provenance of a document. Only
-- `recordGeneration` (inside the generating transaction) writes it.
--
-- Safe against the running code: the table is new (the 0025 lesson).
ALTER TABLE "document_generations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_generations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_generations_superadmin_all ON "document_generations"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY document_generations_member_read ON "document_generations" FOR SELECT
  USING ("tenant_id" = app_current_tenant());
