CREATE TYPE "public"."product_kind" AS ENUM('service', 'product');--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_in_days" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_terms_due_in_days" CHECK ("payment_terms"."due_in_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" "product_kind" DEFAULT 'service' NOT NULL,
	"unit_price_cents" bigint DEFAULT 0 NOT NULL,
	"income_account_id" uuid,
	"expense_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_terms_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_income_account_fk" FOREIGN KEY ("tenant_id","income_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_expense_account_fk" FOREIGN KEY ("tenant_id","expense_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_tenant_id_id_idx" ON "payment_methods" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_tenant_code_idx" ON "payment_methods" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_tenant_id_id_idx" ON "payment_terms" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_tenant_name_idx" ON "payment_terms" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_tenant_default_idx" ON "payment_terms" USING btree ("tenant_id") WHERE "payment_terms"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_id_id_idx" ON "products" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "products_tenant_active_idx" ON "products" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_name_idx" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_terms_fk" FOREIGN KEY ("tenant_id","payment_terms_id") REFERENCES "public"."payment_terms"("tenant_id","id") ON DELETE no action ON UPDATE no action;