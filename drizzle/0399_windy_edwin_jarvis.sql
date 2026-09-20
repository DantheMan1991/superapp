-- A line's number may come from a subcontractor's own bid (X3, ADR 0098).
--
-- Drop and re-add rather than a new constraint, which is how 0373 re-stated
-- the estimate's `presentation` list when `groups` joined it. The live
-- definition of a text enumeration is always the LAST migration that touched
-- it, so read this one and not the schema file's first draft.

ALTER TABLE "job_estimate_lines" DROP CONSTRAINT "job_estimate_lines_basis_valid";--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" DROP CONSTRAINT "job_estimate_proposed_lines_basis_valid";--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_basis_valid" CHECK ("job_estimate_lines"."basis" in ('', 'assembly', 'memory', 'said', 'sub', 'none'));--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" ADD CONSTRAINT "job_estimate_proposed_lines_basis_valid" CHECK ("job_estimate_proposed_lines"."basis" in ('assembly', 'memory', 'said', 'sub', 'none'));