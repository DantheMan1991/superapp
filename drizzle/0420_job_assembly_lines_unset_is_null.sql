-- job_assembly_lines: unset is NULL, not zero (X15). The library screen
-- (X10) saved a line's markup and explicit unit price as 0 when they were
-- unset, so every assembly edited there dropped its lines at an explicit
-- $0.00 price and 0% markup. The screen and its schema now keep null; this
-- puts the rows it wrote back to unset. An explicit $0.00 price on a line
-- that costs something is not a thing anybody meant.
UPDATE "job_assembly_lines" SET "unit_price_cents" = NULL WHERE "unit_price_cents" = 0;
--> statement-breakpoint
UPDATE "job_assembly_lines" SET "markup_ppm" = NULL WHERE "markup_ppm" = 0;
