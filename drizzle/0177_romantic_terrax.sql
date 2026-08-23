CREATE TYPE "public"."accounting_basis" AS ENUM('accrual', 'cash');--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "default_basis" "accounting_basis" DEFAULT 'accrual' NOT NULL;