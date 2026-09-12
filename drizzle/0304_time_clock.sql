-- RENUMBERED FROM 0302 after `claude/preview-links` (#509) took that slot from a
-- parallel session and merged first. The repair is the one conventions.md
-- prescribes: rebase, delete the loser's files, regenerate against the winner's
-- snapshot, and PUT THE ORIGINAL `when` BACK in _journal.json — 1789184104883
-- here, 1789184144785 for 0305. Those are the exact `created_at` values already
-- recorded in dev and prod, and drizzle applies a migration only when
-- `lastApplied.created_at < when`, so a fresh stamp would re-run this against
-- tables that exist.
--
-- The SQL below is NOT what drizzle-kit emitted on regeneration, deliberately.
-- #509's snapshots were generated before it rebased onto slice 0 and so have no
-- `time_workers`, `time_entries` or `time_settings` in them; regenerating
-- against the newest snapshot on main therefore proposed CREATE TABLE for all
-- three, which would abort CI's replay from zero. This file keeps slice 1's
-- actual delta. The 0304 SNAPSHOT is the freshly generated one and is complete,
-- which is what repairs the drift for whoever generates next.
--
-- Time slice 1: the clock. `time_punches` (the raw record), the two columns on
-- `time_entries` that say where an entry came from, and the rounding policy.
-- See docs/modules/time.md.
--
-- HAND-EDITED IN ONE PLACE: `time_entries_punch_fk`. drizzle-kit emits a bare
-- `ON DELETE set null` for it, which on a COMPOSITE key means "null every
-- column in the key" — including `tenant_id`, which is NOT NULL. That
-- constraint could never fire; the first delete of a punch would fail with a
-- not-null violation instead of clearing the link. Postgres 15's column-list
-- form, `ON DELETE SET NULL ("punch_id")`, nulls only the column that should be
-- nulled. drizzle-kit diffs its own snapshot rather than the database, so it
-- does not revert this on the next generate.
--
-- Statement ORDER is drizzle's own and is already right here: the unique index
-- `time_punches_tenant_id_id_idx` is created before the FK that references it.
-- 0300 needed reordering for that reason and this one does not.

CREATE TABLE "time_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by_clerk_user_id" text NOT NULL,
	"ended_by_clerk_user_id" text,
	"note" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_punches_ends_after_start" CHECK ("time_punches"."ended_at" is null or "time_punches"."ended_at" > "time_punches"."started_at")
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "punch_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_settings" ADD COLUMN "rounding_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_worker_fk" FOREIGN KEY ("tenant_id","worker_id") REFERENCES "public"."time_workers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_punches_tenant_id_id_idx" ON "time_punches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_punches_one_open_idx" ON "time_punches" USING btree ("tenant_id","worker_id") WHERE "time_punches"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "time_punches_tenant_started_idx" ON "time_punches" USING btree ("tenant_id","started_at");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_punch_fk" FOREIGN KEY ("tenant_id","punch_id") REFERENCES "public"."time_punches"("tenant_id","id") ON DELETE SET NULL ("punch_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_punch_idx" ON "time_entries" USING btree ("tenant_id","punch_id") WHERE "time_entries"."punch_id" is not null;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_source" CHECK ("time_entries"."source" in ('manual', 'timer'));--> statement-breakpoint
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_rounding_minutes" CHECK ("time_settings"."rounding_minutes" in (0, 5, 6, 10, 15, 30));
