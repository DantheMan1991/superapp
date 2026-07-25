CREATE TABLE "document_share_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"document_id" uuid,
	"kind" text NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"user_agent_hash" text DEFAULT '' NOT NULL,
	"bytes_sent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_share_events_bytes_nonneg" CHECK ("document_share_events"."bytes_sent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid,
	"folder_id" uuid,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"can_download" boolean DEFAULT false NOT NULL,
	"passcode_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"failed_unlock_count" integer DEFAULT 0 NOT NULL,
	"created_root_visibility" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_clerk_user_id" text,
	"created_by_clerk_user_id" text NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_one_scope" CHECK (num_nonnulls("document_shares"."document_id", "document_shares"."folder_id") = 1),
	CONSTRAINT "document_shares_expiry_forward" CHECK ("document_shares"."expires_at" > "document_shares"."created_at"),
	CONSTRAINT "document_shares_max_uses_positive" CHECK ("document_shares"."max_uses" is null or "document_shares"."max_uses" > 0),
	CONSTRAINT "document_shares_use_count_nonneg" CHECK ("document_shares"."use_count" >= 0),
	CONSTRAINT "document_shares_root_visibility" CHECK ("document_shares"."created_root_visibility" in ('members', 'owners'))
);
--> statement-breakpoint
CREATE TABLE "public_access_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Moved up (hand edit): the composite parent key must exist before
-- document_share_events_share_fk references it in this same migration. Same
-- trap as drizzle/0013 and 0023.
CREATE UNIQUE INDEX "document_shares_tenant_id_id_idx" ON "document_shares" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "document_share_events" ADD CONSTRAINT "document_share_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_share_events" ADD CONSTRAINT "document_share_events_share_fk" FOREIGN KEY ("tenant_id","share_id") REFERENCES "public"."document_shares"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_share_events" ADD CONSTRAINT "document_share_events_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_folder_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."document_folders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_share_events_tenant_id_id_idx" ON "document_share_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "document_share_events_share_idx" ON "document_share_events" USING btree ("tenant_id","share_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_shares_token_hash_idx" ON "document_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "document_shares_tenant_document_idx" ON "document_shares" USING btree ("tenant_id","document_id") WHERE "document_shares"."document_id" is not null;--> statement-breakpoint
CREATE INDEX "document_shares_tenant_folder_idx" ON "document_shares" USING btree ("tenant_id","folder_id") WHERE "document_shares"."folder_id" is not null;--> statement-breakpoint
CREATE INDEX "document_shares_tenant_active_idx" ON "document_shares" USING btree ("tenant_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "public_access_attempts_ip_idx" ON "public_access_attempts" USING btree ("ip_hash","kind","created_at");--> statement-breakpoint
CREATE INDEX "public_access_attempts_created_idx" ON "public_access_attempts" USING btree ("created_at");