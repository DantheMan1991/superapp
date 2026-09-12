-- Time slice 5: what it costs. `time_rates`, and the gross the approval
-- snapshot freezes. See docs/modules/time.md.
--
-- `gross_cents` is NOT in `time_sheets_snapshot_with_approval`, unlike the five
-- minute columns it sits beside. It is null for a business that keeps no rates
-- at all, which is a legitimate approved sheet -- hours agreed, money not this
-- product's business -- so tying it to `approved_at` would refuse that.

CREATE TABLE "time_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"pay_rate_cents" integer NOT NULL,
	"bill_rate_cents" integer,
	"burden_percent" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_rates_pay_nonnegative" CHECK ("time_rates"."pay_rate_cents" >= 0),
	CONSTRAINT "time_rates_bill_nonnegative" CHECK ("time_rates"."bill_rate_cents" is null or "time_rates"."bill_rate_cents" >= 0),
	CONSTRAINT "time_rates_burden_range" CHECK ("time_rates"."burden_percent" >= 0 and "time_rates"."burden_percent" <= 200)
);
--> statement-breakpoint
ALTER TABLE "time_sheets" ADD COLUMN "gross_cents" integer;--> statement-breakpoint
ALTER TABLE "time_rates" ADD CONSTRAINT "time_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_rates" ADD CONSTRAINT "time_rates_worker_fk" FOREIGN KEY ("tenant_id","worker_id") REFERENCES "public"."time_workers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_rates_tenant_id_id_idx" ON "time_rates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_rates_worker_effective_idx" ON "time_rates" USING btree ("tenant_id","worker_id","effective_on");