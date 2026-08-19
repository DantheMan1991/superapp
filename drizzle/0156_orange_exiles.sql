CREATE TABLE "livestock_daily_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"logged_on" date NOT NULL,
	"status" text DEFAULT 'normal' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_daily_logs_status_valid" CHECK ("livestock_daily_logs"."status" in ('normal', 'attention'))
);
--> statement-breakpoint
ALTER TABLE "livestock_daily_logs" ADD CONSTRAINT "livestock_daily_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_daily_logs" ADD CONSTRAINT "livestock_daily_logs_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_daily_logs_tenant_id_id_idx" ON "livestock_daily_logs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_daily_logs_tenant_lot_day_idx" ON "livestock_daily_logs" USING btree ("tenant_id","livestock_lot_id","logged_on");--> statement-breakpoint
CREATE INDEX "livestock_daily_logs_tenant_day_idx" ON "livestock_daily_logs" USING btree ("tenant_id","logged_on");