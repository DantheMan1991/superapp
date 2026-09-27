CREATE TYPE "public"."tenant_kind" AS ENUM('business', 'personal');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kind" "tenant_kind" DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "personal_owner_clerk_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_personal_owner_idx" ON "tenants" USING btree ("personal_owner_clerk_user_id") WHERE "tenants"."kind" = 'personal';--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_personal_owner_check" CHECK (("tenants"."kind" = 'personal') = ("tenants"."personal_owner_clerk_user_id" is not null));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_operator_is_business_check" CHECK (not ("tenants"."is_operator" and "tenants"."kind" = 'personal'));