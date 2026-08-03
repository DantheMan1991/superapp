CREATE TABLE "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_templates_name_not_blank" CHECK (length(btrim("mail_templates"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_templates_tenant_id_id_idx" ON "mail_templates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_templates_tenant_name_idx" ON "mail_templates" USING btree ("tenant_id","name_key");