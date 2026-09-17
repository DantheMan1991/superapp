-- What the paper IS, as against how the money is grouped (E5a, ADR 0083): `letter` is the
-- business document ADR 0070 built, `brochure` is the custom-home one. Plus the letter the
-- brochure opens with. Columns and a CHECK on an existing table, so no RLS migration: the
-- 0347 / 0358 / 0375 precedent. Generated clean this once -- no stray foreign key to repair,
-- because 0375's snapshot recorded the item key's intent.

ALTER TABLE "job_estimates" ADD COLUMN "format" text DEFAULT 'letter' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD COLUMN "letter" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_format_valid" CHECK ("job_estimates"."format" in ('letter', 'brochure'));