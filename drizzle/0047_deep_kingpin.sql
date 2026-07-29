CREATE TABLE "mail_saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"mail_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_saved_searches" ADD CONSTRAINT "mail_saved_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_saved_searches" ADD CONSTRAINT "mail_saved_searches_account_fk" FOREIGN KEY ("tenant_id","mail_account_id") REFERENCES "public"."mail_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_saved_searches_tenant_id_id_idx" ON "mail_saved_searches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_saved_searches_name_idx" ON "mail_saved_searches" USING btree ("tenant_id","clerk_user_id","mail_account_id","name_key");--> statement-breakpoint
CREATE INDEX "mail_saved_searches_user_idx" ON "mail_saved_searches" USING btree ("tenant_id","clerk_user_id");