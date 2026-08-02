CREATE TABLE "mail_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"mail_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"match_mode" text DEFAULT 'all' NOT NULL,
	"tests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stop_after" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_account_fk" FOREIGN KEY ("tenant_id","mail_account_id") REFERENCES "public"."mail_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_rules_tenant_id_id_idx" ON "mail_rules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "mail_rules_user_idx" ON "mail_rules" USING btree ("tenant_id","clerk_user_id","mail_account_id");