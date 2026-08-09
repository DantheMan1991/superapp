CREATE TABLE "schedule_item_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"occurrence_date" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_overrides_date_format" CHECK ("schedule_item_overrides"."occurrence_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "recurrence_rule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_item_overrides" ADD CONSTRAINT "schedule_item_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_overrides" ADD CONSTRAINT "schedule_item_overrides_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."schedule_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_overrides_unique_idx" ON "schedule_item_overrides" USING btree ("tenant_id","item_id","occurrence_date");