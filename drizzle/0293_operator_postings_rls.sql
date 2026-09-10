-- operator_postings: RLS. ENABLE + FORCE, superadmin_all ONLY — platform-level.
-- What became of each Stripe charge in the operator's books (ADR 0043,
-- back-office slice 5): written by the signature-verified webhook and the
-- console under withSystem, read by the operator's page. A client's members
-- see nothing of what they paid the platform here; their own invoice is in
-- the operator's books, which are not theirs to read.
--
-- FORCEd for the reason every table here is: the app connects as app_user,
-- and the policy is the backstop, not the application code.

ALTER TABLE "operator_postings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operator_postings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY operator_postings_superadmin_all ON "operator_postings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
