-- The plant's bill, matched to the processing day it pays for. Slice 2d.
--
-- `completeRun` accrues what the plant charged — `Dr consumption / Cr 2060
-- Services Received Not Invoiced` — because the fee went into the meat's cost
-- and nobody had invoiced it yet. NOTHING EVER TOOK IT OFF AGAIN. This table is
-- the third line of that entry:
--
--   accrual        Dr 5000 22370   Cr 2060 22370
--   outputs land   Dr 1300 22370   Cr 5000 22370
--   bill matched   Dr 2060 22370   Dr 5000 1130   Cr AP 23500   <- this
--
-- IT IS `bill_line_stock_allocations` ONE ACCOUNT ALONG, and the shape is copied
-- rather than reinvented: one row per (bill line, run), the accrued figure
-- STAMPED at match time, and the invoice's own share beside it so the difference
-- can be read rather than recomputed.
--
-- `accrued_cents` IS STORED AND NOT RE-READ. It is what the ledger credited when
-- the run finished, and matching clears exactly that — the same rule stock
-- matching follows against a receipt's stamped cost. A later cost correction
-- changes what the meat is worth and must not restate a variance that already
-- posted.
--
-- `corrected_cents` IS WHAT MAKES THE COST CORRECTION IDEMPOTENT. Matching books
-- the difference to the P&L and leaves the meat carrying what it landed with;
-- moving the batch's cost to what was actually billed is a SECOND, deliberate
-- act, because by then the meat is often sold and restating a batch for $11 is
-- not a decision software should make on its own. Without the column a second
-- press would move the cost twice and no screen could say whether it had been
-- done. Same split `inventory` drew between ADR 0012 §A.5 and §A.4.
--
-- CASCADE ON THE BILL LINE IS LOAD-BEARING: `updateBillDraft` deletes and
-- re-inserts every line of a draft, so a bill line's id does not survive an
-- edit. NO cascade on the run — a run is never deleted here, and erasing the
-- record that a bill had settled one would hide the money rather than surface it.
--
-- SAFE TO APPLY AHEAD OF THE DEPLOY: a new table nothing reads until the code
-- that reads it ships. Its RLS policies are in `0205`, which must go with it.

CREATE TABLE "production_run_bill_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_line_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"accrued_cents" integer NOT NULL,
	"billed_cents" integer NOT NULL,
	"corrected_cents" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_bill_allocations_accrued_positive" CHECK ("production_run_bill_allocations"."accrued_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_run_bill_allocations" ADD CONSTRAINT "production_run_bill_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_bill_allocations" ADD CONSTRAINT "production_run_bill_allocations_line_fk" FOREIGN KEY ("tenant_id","bill_line_id") REFERENCES "public"."bill_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_bill_allocations" ADD CONSTRAINT "production_run_bill_allocations_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_bill_allocations_tenant_id_id_idx" ON "production_run_bill_allocations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_bill_allocations_pair_idx" ON "production_run_bill_allocations" USING btree ("tenant_id","bill_line_id","run_id");--> statement-breakpoint
CREATE INDEX "production_run_bill_allocations_run_idx" ON "production_run_bill_allocations" USING btree ("tenant_id","run_id");