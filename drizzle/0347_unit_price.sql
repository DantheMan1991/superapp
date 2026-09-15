ALTER TABLE "job_pay_application_lines" ADD COLUMN "quantity_previous_thousandths" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ADD COLUMN "quantity_this_period_thousandths" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD COLUMN "quantity_thousandths" bigint;--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD COLUMN "unit_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "job_pay_application_lines" ADD CONSTRAINT "job_pay_application_lines_quantity_nonnegative" CHECK ("job_pay_application_lines"."quantity_previous_thousandths" + "job_pay_application_lines"."quantity_this_period_thousandths" >= 0);--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_quantity_nonnegative" CHECK ("job_sov_lines"."quantity_thousandths" is null or "job_sov_lines"."quantity_thousandths" >= 0);--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_unit_price_nonnegative" CHECK ("job_sov_lines"."unit_price_cents" is null or "job_sov_lines"."unit_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "job_sov_lines" ADD CONSTRAINT "job_sov_lines_unit_pair" CHECK (("job_sov_lines"."quantity_thousandths" is null) = ("job_sov_lines"."unit_price_cents" is null));