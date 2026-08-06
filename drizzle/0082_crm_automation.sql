CREATE TABLE "crm_automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_automation_rules" ADD CONSTRAINT "crm_automation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_automation_rules_tenant_id_id_idx" ON "crm_automation_rules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "crm_automation_rules_trigger_idx" ON "crm_automation_rules" USING btree ("tenant_id","trigger") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_automation_rules_name_idx" ON "crm_automation_rules" USING btree ("tenant_id","name");