CREATE TABLE "mail_autofile_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"mail_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_mailbox_id" text,
	"match_from" text DEFAULT '' NOT NULL,
	"destination_folder_id" uuid,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"cursor" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"filed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_autofile_rules_name_not_blank" CHECK (length(btrim("mail_autofile_rules"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_autofile_rules" ADD CONSTRAINT "mail_autofile_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_autofile_rules" ADD CONSTRAINT "mail_autofile_rules_account_fk" FOREIGN KEY ("tenant_id","mail_account_id") REFERENCES "public"."mail_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_autofile_rules_tenant_id_id_idx" ON "mail_autofile_rules" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "mail_autofile_rules_user_idx" ON "mail_autofile_rules" USING btree ("tenant_id","clerk_user_id","mail_account_id");--> statement-breakpoint
CREATE INDEX "mail_autofile_rules_due_idx" ON "mail_autofile_rules" USING btree ("is_enabled","last_run_at");