CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"jmap_session_url" text DEFAULT '' NOT NULL,
	"jmap_account_id" text DEFAULT '' NOT NULL,
	"access_token_enc" text DEFAULT '' NOT NULL,
	"refresh_token_enc" text DEFAULT '' NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_state" text DEFAULT '' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_accounts_status_check" CHECK ("mail_accounts"."status" in ('connected', 'needs_reauth', 'revoked', 'error'))
);
--> statement-breakpoint
CREATE TABLE "mail_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"extension_slug" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_annotations_extension_slug_format" CHECK ("mail_annotations"."extension_slug" ~ '^[a-z][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "mail_directory_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"login" text NOT NULL,
	"password_hash" text,
	"account_type" text DEFAULT 'individual' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"quota_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_directory_account_type_check" CHECK ("mail_directory_accounts"."account_type" in ('individual', 'group'))
);
--> statement-breakpoint
CREATE TABLE "mail_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"extension_slug" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_links_entity_type_format" CHECK ("mail_links"."entity_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "mail_links_extension_slug_format" CHECK ("mail_links"."extension_slug" ~ '^[a-z][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "mail_thread_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mail_account_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_mailbox_fk" FOREIGN KEY ("tenant_id","mailbox_id") REFERENCES "public"."mailboxes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_annotations" ADD CONSTRAINT "mail_annotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_directory_accounts" ADD CONSTRAINT "mail_directory_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_directory_accounts" ADD CONSTRAINT "mail_directory_mailbox_fk" FOREIGN KEY ("tenant_id","mailbox_id") REFERENCES "public"."mailboxes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_links" ADD CONSTRAINT "mail_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread_index" ADD CONSTRAINT "mail_thread_index_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-reordered, same fix and same reason as drizzle/0039: drizzle-kit emits
-- every FK before every index, which breaks when the referenced table is also
-- new in this migration. mail_thread_index_account_fk points at
-- mail_accounts(tenant_id, id), so that unique index has to exist first.
-- Only the order changed; no statement was altered.
CREATE UNIQUE INDEX "mail_accounts_tenant_id_id_idx" ON "mail_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "mail_thread_index" ADD CONSTRAINT "mail_thread_index_account_fk" FOREIGN KEY ("tenant_id","mail_account_id") REFERENCES "public"."mail_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_mailbox_user_idx" ON "mail_accounts" USING btree ("tenant_id","mailbox_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "mail_accounts_user_idx" ON "mail_accounts" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_annotations_tenant_id_id_idx" ON "mail_annotations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_annotations_unique_idx" ON "mail_annotations" USING btree ("tenant_id","thread_id","extension_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_directory_tenant_id_id_idx" ON "mail_directory_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_directory_login_idx" ON "mail_directory_accounts" USING btree ("login");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_directory_mailbox_idx" ON "mail_directory_accounts" USING btree ("mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_links_tenant_id_id_idx" ON "mail_links" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_links_unique_idx" ON "mail_links" USING btree ("tenant_id","thread_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "mail_links_entity_idx" ON "mail_links" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "mail_links_thread_idx" ON "mail_links" USING btree ("tenant_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_thread_index_tenant_id_id_idx" ON "mail_thread_index" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_thread_index_thread_idx" ON "mail_thread_index" USING btree ("tenant_id","mail_account_id","thread_id");--> statement-breakpoint
CREATE INDEX "mail_thread_index_recent_idx" ON "mail_thread_index" USING btree ("tenant_id","last_message_at");