-- Time slice 7: a shared device by the barn door.
--
-- RENUMBERED FROM 0316 to 0318: a parallel session's Social migrations took
-- both slots first. The `when` below is the ORIGINAL one, deliberately -- dev
-- and prod already applied this under it, and drizzle decides what to run by
-- comparing `when` against the high-water mark, so a fresh timestamp would
-- make both databases try to add these columns again.
--
-- `pin_hash` is scrypt via `hashPasscode`, the treatment a document share's
-- passcode gets, because it is the same kind of secret. It sits on the
-- member-wide `time_workers` rather than behind an owners-only policy like
-- `time_rates`, and the schema comment carries the argument: staff can already
-- clock anybody in from the ordinary panel, so reading the hash would gain a
-- signed-in member nothing. The PIN's threat is the passer-by with no session.
--
-- `client_ref` is the half of offline that cannot be retrofitted -- the device
-- mints it before it reaches the network, and the partial unique index turns a
-- retry into a no-op instead of a double punch. Same trick, same reason, as
-- `retail_sales.client_ref`. Clock-OUT needs no equivalent: the existing
-- `time_entries_punch_idx` already allows one entry per punch.
--
-- The CHECK on `time_entries.source` is DROPPED AND RE-ADDED rather than
-- altered, which is the only way Postgres widens one. Every existing row holds
-- 'manual' or 'timer' and still satisfies the wider set, so the re-add cannot
-- fail on live data.

ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_source";--> statement-breakpoint
ALTER TABLE "time_punches" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "time_punches" ADD COLUMN "device_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_workers" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "time_workers" ADD COLUMN "pin_failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_workers" ADD COLUMN "pin_failed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "time_punches_client_ref_idx" ON "time_punches" USING btree ("tenant_id","client_ref") WHERE "time_punches"."client_ref" is not null;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_source" CHECK ("time_entries"."source" in ('manual', 'timer', 'kiosk'));