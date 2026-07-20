CREATE TYPE "public"."audit_status" AS ENUM('open', 'report_ready', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"industry" text DEFAULT 'general' NOT NULL,
	"contact_name" text,
	"status" "audit_status" DEFAULT 'open' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audits_status_idx" ON "audits" USING btree ("status");