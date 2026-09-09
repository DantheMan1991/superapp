CREATE TYPE "public"."bank_rule_action" AS ENUM('categorize', 'exclude');--> statement-breakpoint
ALTER TYPE "public"."bank_account_kind" ADD VALUE 'personal';--> statement-breakpoint
ALTER TABLE "bank_rules" ALTER COLUMN "set_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD COLUMN "action" "bank_rule_action" DEFAULT 'categorize' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_action_account" CHECK (("bank_rules"."action" = 'exclude') = ("bank_rules"."set_account_id" is null));