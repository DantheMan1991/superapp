CREATE TABLE "mailbox_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"provider" text DEFAULT 'migadu' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previous_mx" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"mx_cutover_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_domains_status_check" CHECK ("mailbox_domains"."status" in ('pending', 'dns_ready', 'active', 'failed')),
	CONSTRAINT "mailbox_domains_domain_not_blank" CHECK (length("mailbox_domains"."domain") > 3),
	CONSTRAINT "mailbox_domains_provider_check" CHECK ("mailbox_domains"."provider" in ('migadu', 'stalwart')),
	CONSTRAINT "mailbox_domains_active_has_cutover" CHECK ("mailbox_domains"."status" <> 'active' or "mailbox_domains"."mx_cutover_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_domain_id" uuid NOT NULL,
	"local_part" text NOT NULL,
	"address" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"clerk_user_id" text,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"may_send" boolean DEFAULT true NOT NULL,
	"may_receive" boolean DEFAULT true NOT NULL,
	"may_access_imap" boolean DEFAULT true NOT NULL,
	"invite_pending" boolean DEFAULT false NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_status_check" CHECK ("mailboxes"."status" in ('provisioning', 'active', 'suspended', 'failed')),
	CONSTRAINT "mailboxes_local_part_format" CHECK ("mailboxes"."local_part" ~ '^[a-z0-9][a-z0-9._-]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "mailbox_domains" ADD CONSTRAINT "mailbox_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-reordered: the composite FK below references (tenant_id, id) on
-- mailbox_domains, and Postgres will only accept that once a unique index
-- covers those columns. drizzle-kit emits all FKs before all indexes, which is
-- fine when the referenced table already exists but fails when both tables are
-- created in the same migration. Moving the three mailbox_domains indexes
-- above the FK is the whole fix — no statement was changed, only ordered.
CREATE UNIQUE INDEX "mailbox_domains_tenant_id_id_idx" ON "mailbox_domains" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_domains_tenant_idx" ON "mailbox_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_domains_domain_idx" ON "mailbox_domains" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_fk" FOREIGN KEY ("tenant_id","mailbox_domain_id") REFERENCES "public"."mailbox_domains"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_tenant_id_id_idx" ON "mailboxes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_domain_local_part_idx" ON "mailboxes" USING btree ("mailbox_domain_id","local_part");--> statement-breakpoint
CREATE INDEX "mailboxes_tenant_status_idx" ON "mailboxes" USING btree ("tenant_id","status");