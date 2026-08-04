CREATE TYPE "public"."party_contact_kind" AS ENUM('email', 'phone', 'website');--> statement-breakpoint
CREATE TABLE "party_contact_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" "party_contact_kind" NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_contact_points" ADD CONSTRAINT "party_contact_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_contact_points" ADD CONSTRAINT "party_contact_points_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_contact_points_tenant_id_id_idx" ON "party_contact_points" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_contact_points_primary_idx" ON "party_contact_points" USING btree ("tenant_id","party_id","kind") WHERE is_primary = true;--> statement-breakpoint
CREATE UNIQUE INDEX "party_contact_points_unique_idx" ON "party_contact_points" USING btree ("tenant_id","party_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "party_contact_points_lookup_idx" ON "party_contact_points" USING btree ("tenant_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "party_contact_points_party_idx" ON "party_contact_points" USING btree ("tenant_id","party_id");