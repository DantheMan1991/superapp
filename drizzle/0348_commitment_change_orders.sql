CREATE TABLE "job_commitment_change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"change_order_id" uuid,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"requested_on" date,
	"approved_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_commitment_change_orders_number_present" CHECK (length(btrim("job_commitment_change_orders"."number")) > 0),
	CONSTRAINT "job_commitment_change_orders_title_present" CHECK (length(btrim("job_commitment_change_orders"."title")) > 0),
	CONSTRAINT "job_commitment_change_orders_status_valid" CHECK ("job_commitment_change_orders"."status" in ('proposed', 'approved', 'declined', 'void')),
	CONSTRAINT "job_commitment_change_orders_approved_has_date" CHECK (("job_commitment_change_orders"."status" = 'approved') = ("job_commitment_change_orders"."approved_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "job_commitment_lines" DROP CONSTRAINT "job_commitment_lines_amount_nonnegative";--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" DROP CONSTRAINT "job_sub_application_lines_previous_nonnegative";--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" DROP CONSTRAINT "job_sub_application_lines_completed_nonnegative";--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD COLUMN "change_order_id" uuid;--> statement-breakpoint
ALTER TABLE "job_commitment_change_orders" ADD CONSTRAINT "job_commitment_change_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitment_change_orders" ADD CONSTRAINT "job_commitment_change_orders_commitment_fk" FOREIGN KEY ("tenant_id","commitment_id") REFERENCES "public"."job_commitments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commitment_change_orders" ADD CONSTRAINT "job_commitment_change_orders_change_order_fk" FOREIGN KEY ("tenant_id","change_order_id") REFERENCES "public"."job_change_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_commitment_change_orders_tenant_id_id_idx" ON "job_commitment_change_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_commitment_change_orders_commitment_number_idx" ON "job_commitment_change_orders" USING btree ("tenant_id","commitment_id","number");--> statement-breakpoint
CREATE INDEX "job_commitment_change_orders_tenant_commitment_idx" ON "job_commitment_change_orders" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "job_commitment_change_orders_tenant_status_idx" ON "job_commitment_change_orders" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD CONSTRAINT "job_commitment_lines_change_order_fk" FOREIGN KEY ("tenant_id","change_order_id") REFERENCES "public"."job_commitment_change_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_commitment_lines_tenant_change_idx" ON "job_commitment_lines" USING btree ("tenant_id","change_order_id");--> statement-breakpoint
ALTER TABLE "job_commitment_lines" ADD CONSTRAINT "job_commitment_lines_amount_nonnegative" CHECK ("job_commitment_lines"."amount_cents" >= 0 or "job_commitment_lines"."change_order_id" is not null);--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ADD CONSTRAINT "job_sub_application_lines_previous_nonnegative" CHECK ("job_sub_application_lines"."previous_cents" >= 0 or "job_sub_application_lines"."scheduled_cents" < 0);--> statement-breakpoint
ALTER TABLE "job_sub_application_lines" ADD CONSTRAINT "job_sub_application_lines_completed_nonnegative" CHECK (case when "job_sub_application_lines"."scheduled_cents" < 0 then "job_sub_application_lines"."previous_cents" + "job_sub_application_lines"."this_period_cents" + "job_sub_application_lines"."stored_cents" <= 0 else "job_sub_application_lines"."previous_cents" + "job_sub_application_lines"."this_period_cents" + "job_sub_application_lines"."stored_cents" >= 0 end);