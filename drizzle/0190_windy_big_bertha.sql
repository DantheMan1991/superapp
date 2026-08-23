-- HAND-EDITED TWICE. Both edits matter; read before regenerating.
--
-- (1) FOUR UNRELATED CONSTRAINTS WERE STRIPPED. drizzle-kit emitted a DROP and
--     an identical re-ADD for `audit_log_tenant_id_tenants_id_fk`,
--     `interview_sessions_audit_id_audits_id_fk`, `schedule_items_parent_fk`
--     and `work_items_parent_fk` — snapshot churn, not a change. Checked
--     against production with `pg_get_constraintdef`: all four already have
--     exactly the definition it wanted to re-add. Dropping and re-adding three
--     other modules' foreign keys inside a production-pack migration is risk
--     with no upside, so they are gone.
--
-- (2) THE BACKFILL BELOW HAS TO RUN BEFORE THE CHECK, or the migration fails on
--     any database with a finished run in it — which is every one of them.
--     `production_runs_finished_states_inspection` says a complete run must say
--     how it was inspected, and every run that completed before this migration
--     says nothing. `uninspected` is the truthful value for all of them: none
--     had a processor, because there was no column to name one in.

ALTER TABLE "production_runs" ADD COLUMN "processor_id" uuid;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "inspection" text;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_inspection_valid" CHECK ("production_runs"."inspection" is null or "production_runs"."inspection" in ('usda', 'state', 'custom_exempt', 'uninspected', 'unknown'));--> statement-breakpoint

-- Every run that finished before this column existed was done on this farm,
-- because nothing could have recorded a plant. Nobody inspected it.
UPDATE "production_runs" SET "inspection" = 'uninspected'
  WHERE "status" = 'complete' AND "inspection" IS NULL;--> statement-breakpoint

ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_finished_states_inspection" CHECK ("production_runs"."status" <> 'complete' or "production_runs"."inspection" is not null);
