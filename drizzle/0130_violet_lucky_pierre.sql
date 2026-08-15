CREATE TABLE "asset_maintenance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"schedule_id" uuid,
	"performed_on" date NOT NULL,
	"meter_reading" integer,
	"description" text DEFAULT '' NOT NULL,
	"work_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ame_meter_nonnegative" CHECK ("asset_maintenance_events"."meter_reading" is null or "asset_maintenance_events"."meter_reading" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"interval_months" integer,
	"interval_meter" integer,
	"meter_unit" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ams_kind_valid" CHECK ("asset_maintenance_schedules"."kind" in ('calendar', 'meter')),
	CONSTRAINT "ams_name_present" CHECK (length(btrim("asset_maintenance_schedules"."name")) > 0),
	CONSTRAINT "ams_interval_matches_kind" CHECK (("asset_maintenance_schedules"."kind" = 'calendar' and "asset_maintenance_schedules"."interval_months" > 0 and "asset_maintenance_schedules"."interval_meter" is null)
       or ("asset_maintenance_schedules"."kind" = 'meter' and "asset_maintenance_schedules"."interval_meter" > 0 and "asset_maintenance_schedules"."interval_months" is null))
);
--> statement-breakpoint
CREATE TABLE "asset_meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"read_on" date NOT NULL,
	"reading" integer NOT NULL,
	"unit" text DEFAULT 'hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amr_reading_nonnegative" CHECK ("asset_meter_readings"."reading" >= 0)
);
--> statement-breakpoint
ALTER TABLE "asset_maintenance_events" ADD CONSTRAINT "asset_maintenance_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance_events" ADD CONSTRAINT "ame_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance_events" ADD CONSTRAINT "ame_schedule_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."asset_maintenance_schedules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance_schedules" ADD CONSTRAINT "asset_maintenance_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance_schedules" ADD CONSTRAINT "ams_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "asset_meter_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "amr_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ame_tenant_id_id_idx" ON "asset_maintenance_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ame_tenant_asset_idx" ON "asset_maintenance_events" USING btree ("tenant_id","asset_id","performed_on");--> statement-breakpoint
CREATE INDEX "ame_tenant_schedule_idx" ON "asset_maintenance_events" USING btree ("tenant_id","schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ams_tenant_id_id_idx" ON "asset_maintenance_schedules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ams_tenant_asset_idx" ON "asset_maintenance_schedules" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "amr_tenant_id_id_idx" ON "asset_meter_readings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "amr_tenant_asset_read_idx" ON "asset_meter_readings" USING btree ("tenant_id","asset_id","read_on");