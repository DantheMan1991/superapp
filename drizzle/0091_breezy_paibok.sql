CREATE TABLE "crm_automation_rule_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"consecutive_failures" integer DEFAULT 1 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_error_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_automation_rule_health" ADD CONSTRAINT "crm_automation_rule_health_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_automation_rule_health" ADD CONSTRAINT "crm_automation_rule_health_rule_id_crm_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."crm_automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_automation_rule_health_rule_idx" ON "crm_automation_rule_health" USING btree ("rule_id");