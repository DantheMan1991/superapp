CREATE TABLE "job_estimate_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_clerk_user_id" text,
	"created_by_clerk_user_id" text NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"signed_ip_hash" text,
	"signed_estimate_version" integer,
	"signed_total_cents" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_shares_signature_whole" CHECK (num_nonnulls("job_estimate_shares"."signed_at", "job_estimate_shares"."signed_name", "job_estimate_shares"."signed_ip_hash", "job_estimate_shares"."signed_estimate_version", "job_estimate_shares"."signed_total_cents") in (0, 5)),
	CONSTRAINT "job_estimate_shares_signed_name_present" CHECK ("job_estimate_shares"."signed_name" is null or length(btrim("job_estimate_shares"."signed_name")) > 0),
	CONSTRAINT "job_estimate_shares_signed_name_bounded" CHECK ("job_estimate_shares"."signed_name" is null or char_length("job_estimate_shares"."signed_name") <= 120),
	CONSTRAINT "job_estimate_shares_view_count_nonneg" CHECK ("job_estimate_shares"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_estimate_shares" ADD CONSTRAINT "job_estimate_shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_shares" ADD CONSTRAINT "job_estimate_shares_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."job_estimates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_shares_tenant_id_id_idx" ON "job_estimate_shares" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_shares_token_hash_idx" ON "job_estimate_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "job_estimate_shares_tenant_estimate_idx" ON "job_estimate_shares" USING btree ("tenant_id","estimate_id");