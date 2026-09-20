-- Asking subcontractors what a scope will cost (X3, ADR 0098).
--
-- HAND-REORDERED, as 0389, 0392, 0379, 0356 and 0352 had to be: drizzle emits
-- every foreign key before every index, so `job_bid_invitations_package_fk`
-- landed ahead of the unique index on job_bid_packages (tenant_id, id) that
-- makes those columns a legal target. The parent's index is moved first.
--
-- `token_hash` is GLOBALLY unique with no tenant prefix, exactly as
-- job_estimate_shares' is: the public lookup has no tenant to scope by.

CREATE TABLE "job_bid_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_clerk_user_id" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"amount_cents" bigint,
	"declined" boolean DEFAULT false NOT NULL,
	"replied_name" text DEFAULT '' NOT NULL,
	"reply_note" text DEFAULT '' NOT NULL,
	"replied_ip_hash" text,
	"is_awarded" boolean DEFAULT false NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_bid_invitations_amount_sane" CHECK ("job_bid_invitations"."amount_cents" is null or "job_bid_invitations"."amount_cents" >= 0),
	CONSTRAINT "job_bid_invitations_reply_whole" CHECK (("job_bid_invitations"."replied_at" is null
            and "job_bid_invitations"."amount_cents" is null
            and not "job_bid_invitations"."declined"
            and "job_bid_invitations"."replied_name" = '')
          or ("job_bid_invitations"."replied_at" is not null
            and length(btrim("job_bid_invitations"."replied_name")) > 0
            and (("job_bid_invitations"."declined" and "job_bid_invitations"."amount_cents" is null)
              or (not "job_bid_invitations"."declined" and "job_bid_invitations"."amount_cents" is not null)))),
	CONSTRAINT "job_bid_invitations_award_has_a_number" CHECK (not "job_bid_invitations"."is_awarded" or "job_bid_invitations"."amount_cents" is not null)
);
--> statement-breakpoint
CREATE TABLE "job_bid_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"cost_code" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_bid_packages_title_present" CHECK (length(btrim("job_bid_packages"."title")) > 0),
	CONSTRAINT "job_bid_packages_status_valid" CHECK ("job_bid_packages"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_bid_packages_tenant_id_id_idx" ON "job_bid_packages" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "job_bid_invitations" ADD CONSTRAINT "job_bid_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_bid_invitations" ADD CONSTRAINT "job_bid_invitations_package_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."job_bid_packages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_bid_invitations" ADD CONSTRAINT "job_bid_invitations_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_bid_packages" ADD CONSTRAINT "job_bid_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_bid_packages" ADD CONSTRAINT "job_bid_packages_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "job_bid_invitations_tenant_id_id_idx" ON "job_bid_invitations" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_bid_invitations_token_hash_idx" ON "job_bid_invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "job_bid_invitations_tenant_package_idx" ON "job_bid_invitations" USING btree ("tenant_id","package_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_bid_invitations_one_per_party_idx" ON "job_bid_invitations" USING btree ("tenant_id","package_id","party_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_bid_invitations_one_award_idx" ON "job_bid_invitations" USING btree ("tenant_id","package_id") WHERE "job_bid_invitations"."is_awarded";
--> statement-breakpoint
CREATE INDEX "job_bid_packages_tenant_project_idx" ON "job_bid_packages" USING btree ("tenant_id","project_id");
