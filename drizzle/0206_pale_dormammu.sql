CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"disabled_reason" text,
	"requirements_currently_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_past_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_due_by" timestamp with time zone,
	"country" text,
	"default_currency" text,
	"business_name" text,
	"deauthorized_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_stripe_account_id_shape" CHECK ("payment_accounts"."stripe_account_id" ~ '^acct_[A-Za-z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_id_id_idx" ON "payment_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_entity_idx" ON "payment_accounts" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_unassigned_idx" ON "payment_accounts" USING btree ("tenant_id") WHERE "payment_accounts"."entity_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_tenant_account_idx" ON "payment_accounts" USING btree ("tenant_id","stripe_account_id");--> statement-breakpoint
CREATE INDEX "payment_accounts_account_idx" ON "payment_accounts" USING btree ("stripe_account_id");