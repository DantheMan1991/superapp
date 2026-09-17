-- The client's words, the line kept off the proposal, and the cost code's number (ADR 0080).
-- Columns and CHECKs on two existing tables, so there is no RLS migration: the 0347 and 0358 precedent.
--
-- HAND-EDITED, and this is the important part. drizzle-kit generated a DROP and re-ADD of
-- `job_estimate_lines_group_fk` alongside these columns, and re-added it as a BARE
-- `ON DELETE set null` — which can never run on a composite `(tenant_id, group_id)` key, because
-- it would try to null `tenant_id` too. 0373 installed that constraint in PG 15's column-list
-- form on purpose (`ON DELETE SET NULL ("group_id")`, the 0046 precedent). Nothing about the
-- foreign key changed here, so both statements are removed rather than repaired: the constraint
-- in the database is already the right one, and re-creating it from a snapshot that cannot
-- express the column list is how removing an item would have started failing in production.

ALTER TABLE "job_estimate_lines" ADD COLUMN "client_description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD COLUMN "client_visible" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_estimates" ADD COLUMN "show_code_numbers" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_client_description_bounded" CHECK (char_length("job_estimate_lines"."client_description") <= 300);
--> statement-breakpoint
-- Hidden money has to have somewhere to hide, and an item is that somewhere.
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_hidden_needs_item" CHECK ("job_estimate_lines"."client_visible" or "job_estimate_lines"."group_id" is not null);
