CREATE TABLE "mail_scheduled_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"mail_account_id" uuid NOT NULL,
	"email_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"from_email" text NOT NULL,
	"drafts_mailbox_id" text NOT NULL,
	"sent_mailbox_id" text,
	"envelope_rcpt_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_scheduled_sends" ADD CONSTRAINT "mail_scheduled_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_scheduled_sends" ADD CONSTRAINT "mail_scheduled_sends_account_fk" FOREIGN KEY ("tenant_id","mail_account_id") REFERENCES "public"."mail_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_scheduled_sends_tenant_id_id_idx" ON "mail_scheduled_sends" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_scheduled_sends_message_idx" ON "mail_scheduled_sends" USING btree ("tenant_id","clerk_user_id","mail_account_id","email_id");--> statement-breakpoint
CREATE INDEX "mail_scheduled_sends_due_idx" ON "mail_scheduled_sends" USING btree ("send_at");