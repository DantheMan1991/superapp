CREATE TABLE "email_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"provider_domain_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_local_part" text DEFAULT 'notifications' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_domains_status_check" CHECK ("email_domains"."status" in ('pending', 'verified', 'failed')),
	CONSTRAINT "email_domains_local_part_format" CHECK ("email_domains"."from_local_part" ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
	CONSTRAINT "email_domains_domain_not_blank" CHECK (length("email_domains"."domain") > 3)
);
--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"to_domain" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_address" text DEFAULT '' NOT NULL,
	"from_tenant_domain" boolean DEFAULT false NOT NULL,
	"provider_message_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_emails_status_check" CHECK ("outbound_emails"."status" in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "email_domains" ADD CONSTRAINT "email_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_domains_tenant_id_id_idx" ON "email_domains" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_domains_tenant_idx" ON "email_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_domains_domain_idx" ON "email_domains" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_emails_tenant_id_id_idx" ON "outbound_emails" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_emails_idempotency_idx" ON "outbound_emails" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbound_emails_tenant_created_idx" ON "outbound_emails" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_emails_provider_idx" ON "outbound_emails" USING btree ("provider_message_id") WHERE "outbound_emails"."provider_message_id" is not null;