CREATE TABLE "payment_readers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"stripe_reader_id" text NOT NULL,
	"stripe_location_id" text NOT NULL,
	"label" text NOT NULL,
	"device_type" text,
	"status" text,
	"archived_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_readers_stripe_reader_id_shape" CHECK ("payment_readers"."stripe_reader_id" ~ '^tmr_[A-Za-z0-9]+$'),
	CONSTRAINT "payment_readers_stripe_location_id_shape" CHECK ("payment_readers"."stripe_location_id" ~ '^tml_[A-Za-z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "payment_readers" ADD CONSTRAINT "payment_readers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_readers" ADD CONSTRAINT "payment_readers_account_fk" FOREIGN KEY ("tenant_id","payment_account_id") REFERENCES "public"."payment_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_readers_tenant_id_id_idx" ON "payment_readers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_readers_tenant_reader_idx" ON "payment_readers" USING btree ("tenant_id","stripe_reader_id");--> statement-breakpoint
CREATE INDEX "payment_readers_tenant_account_idx" ON "payment_readers" USING btree ("tenant_id","payment_account_id");