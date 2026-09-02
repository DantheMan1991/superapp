CREATE TABLE "payment_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text DEFAULT '' NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP CONSTRAINT "payment_accounts_stripe_account_id_shape";--> statement-breakpoint
DROP INDEX "payment_accounts_tenant_entity_idx";--> statement-breakpoint
DROP INDEX "payment_accounts_tenant_unassigned_idx";--> statement-breakpoint
ALTER TABLE "payment_accounts" ALTER COLUMN "stripe_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "square_merchant_id" text;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "square_main_location_id" text;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "square_locations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_credentials" ADD CONSTRAINT "payment_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_credentials" ADD CONSTRAINT "payment_credentials_account_fk" FOREIGN KEY ("tenant_id","payment_account_id") REFERENCES "public"."payment_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_credentials_tenant_id_id_idx" ON "payment_credentials" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_credentials_tenant_account_idx" ON "payment_credentials" USING btree ("tenant_id","payment_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_square_merchant_idx" ON "payment_accounts" USING btree ("tenant_id","square_merchant_id");--> statement-breakpoint
CREATE INDEX "payment_accounts_square_merchant_idx" ON "payment_accounts" USING btree ("square_merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_entity_idx" ON "payment_accounts" USING btree ("tenant_id","entity_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_unassigned_idx" ON "payment_accounts" USING btree ("tenant_id","provider") WHERE "payment_accounts"."entity_id" is null;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_provider_known" CHECK ("payment_accounts"."provider" in ('stripe', 'square'));--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_stripe_id_matches_provider" CHECK (("payment_accounts"."provider" = 'stripe') = ("payment_accounts"."stripe_account_id" is not null));--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_square_id_matches_provider" CHECK (("payment_accounts"."provider" = 'square') = ("payment_accounts"."square_merchant_id" is not null));--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_stripe_account_id_shape" CHECK ("payment_accounts"."stripe_account_id" is null or "payment_accounts"."stripe_account_id" ~ '^acct_[A-Za-z0-9]+$');