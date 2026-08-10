CREATE TYPE "public"."bank_rule_applies_to" AS ENUM('money_in', 'money_out', 'both');--> statement-breakpoint
CREATE TYPE "public"."bank_rule_match_mode" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_suggested" boolean DEFAULT false NOT NULL,
	"applies_to" "bank_rule_applies_to" DEFAULT 'both' NOT NULL,
	"bank_account_id" uuid,
	"match_mode" "bank_rule_match_mode" DEFAULT 'all' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"set_account_id" uuid NOT NULL,
	"set_memo" text,
	"auto_post" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "rule_suggestion" jsonb;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_set_account_fk" FOREIGN KEY ("tenant_id","set_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_rules_tenant_id_id_idx" ON "bank_rules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "bank_rules_tenant_active_priority_idx" ON "bank_rules" USING btree ("tenant_id","is_active","priority");