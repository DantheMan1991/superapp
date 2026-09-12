-- Time slice 2: what a pay period is, and which overtime rules apply. Three
-- columns on `time_settings`. See docs/modules/time.md.
--
-- RENUMBERED FROM 0306 after `Social S0` (#511) took that slot from a parallel
-- session and merged first — the second slot collision in three slices, and the
-- repair is the one conventions.md prescribes both times: rebase, delete the
-- loser's files, take the winner's journal and snapshots whole, regenerate, and
-- PUT THE ORIGINAL `when` BACK (1789187568900). Drizzle applies a migration
-- only when `lastApplied.created_at < when`, so a fresh stamp would re-run
-- these ADD COLUMNs against columns that exist and abort the whole migrate
-- transaction. `scripts/inspect-migration-state.ts` confirms both databases
-- against the renumbered journal.
--
-- Unlike 0304's renumber, the regenerated SQL here is byte-identical to what it
-- replaces: #511's snapshots were produced after slice 1 merged, so they carry
-- the time tables and the diff had nothing stale to trip over.
--
-- NO RLS MIGRATION ACCOMPANIES THIS ONE, and that is correct rather than an
-- omission: `time_settings` is already ENABLE + FORCE with its superadmin and
-- member policies (0301), and a policy names ROWS, not columns. A new column on
-- a protected table is protected the moment it exists.
--
-- NO `time_periods` TABLE EITHER. A pay period is arithmetic over these three
-- settings (`core/periods.ts`) and nothing about one is worth storing until it
-- can be approved and locked, which is slice 3. Materialising it now would be a
-- table whose only column anybody reads is one this migration already holds.
--
-- The thresholds themselves are deliberately NOT here. `overtime_ruleset` is a
-- slug naming a data file in `core/rulesets.ts`: two places holding the
-- definition of "over 40" is two places to get it wrong, and a business does
-- not want its rules frozen at the moment it signed up.

ALTER TABLE "time_settings" ADD COLUMN "pay_frequency" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_settings" ADD COLUMN "period_anchor" date;--> statement-breakpoint
ALTER TABLE "time_settings" ADD COLUMN "overtime_ruleset" text DEFAULT 'federal' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_pay_frequency" CHECK ("time_settings"."pay_frequency" in ('weekly', 'biweekly', 'semimonthly', 'monthly'));--> statement-breakpoint
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_overtime_ruleset" CHECK ("time_settings"."overtime_ruleset" in ('federal', 'california', 'none'));--> statement-breakpoint
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_anchor_only_biweekly" CHECK ("time_settings"."period_anchor" is null or "time_settings"."pay_frequency" = 'biweekly');