-- assets: model number, and the columns a depreciation schedule needs.
--
-- HAND-EDITED. drizzle-kit put `ALTER TYPE "journal_entry_source" ADD VALUE
-- 'depreciation'` at the top of this file as well as generating it into 0127.
-- Two problems with leaving it: 0127 runs first and already added the label, so
-- this would fail with "enum label already exists"; and it would put the ADD
-- VALUE in the same transaction as everything below, which is the arrangement
-- 0036/0037 exists to warn about. The generator does not know the value is
-- already carried by its own earlier file — check for this whenever an enum
-- gains a value.
--
-- Note `assets_depreciable_is_complete`: a method other than 'none' requires an
-- in-service date, a life AND a cost. A half-configured asset would otherwise
-- depreciate by nothing and look like a working one, which is the failure mode
-- worth making unrepresentable rather than merely validated.

ALTER TABLE "assets" ADD COLUMN "model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "in_service_on" date;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "depreciation_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "useful_life_months" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "salvage_value_cents" bigint;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_depreciation_method_valid" CHECK ("assets"."depreciation_method" in ('none', 'straight_line'));--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_useful_life_positive" CHECK ("assets"."useful_life_months" is null or "assets"."useful_life_months" > 0);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_salvage_nonnegative" CHECK ("assets"."salvage_value_cents" is null or "assets"."salvage_value_cents" >= 0);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_depreciable_is_complete" CHECK ("assets"."depreciation_method" = 'none' or (
        "assets"."in_service_on" is not null
        and "assets"."useful_life_months" is not null
        and "assets"."acquisition_cost_cents" is not null
      ));
