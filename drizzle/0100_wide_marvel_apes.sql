CREATE TABLE "schedule_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_feed_tokens" ADD CONSTRAINT "schedule_feed_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_feed_tokens_hash_idx" ON "schedule_feed_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "schedule_feed_tokens_owner_idx" ON "schedule_feed_tokens" USING btree ("tenant_id","clerk_user_id");