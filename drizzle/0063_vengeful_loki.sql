CREATE TYPE "public"."crm_visibility" AS ENUM('members', 'restricted');--> statement-breakpoint
CREATE TABLE "crm_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_party_id" uuid NOT NULL,
	"organization_party_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"started_on" date,
	"ended_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_affiliations_distinct_parties" CHECK ("crm_affiliations"."person_party_id" <> "crm_affiliations"."organization_party_id")
);
--> statement-breakpoint
CREATE TABLE "crm_party_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"owner_clerk_user_id" text,
	"visibility" "crm_visibility" DEFAULT 'members' NOT NULL,
	"lifecycle_stage" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_affiliations" ADD CONSTRAINT "crm_affiliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_affiliations" ADD CONSTRAINT "crm_affiliations_person_fk" FOREIGN KEY ("tenant_id","person_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_affiliations" ADD CONSTRAINT "crm_affiliations_org_fk" FOREIGN KEY ("tenant_id","organization_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_party_details" ADD CONSTRAINT "crm_party_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_party_details" ADD CONSTRAINT "crm_party_details_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_affiliations_tenant_id_id_idx" ON "crm_affiliations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "crm_affiliations_tenant_person_idx" ON "crm_affiliations" USING btree ("tenant_id","person_party_id");--> statement-breakpoint
CREATE INDEX "crm_affiliations_tenant_org_idx" ON "crm_affiliations" USING btree ("tenant_id","organization_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_affiliations_current_idx" ON "crm_affiliations" USING btree ("tenant_id","person_party_id","organization_party_id") WHERE ended_on is null;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_affiliations_primary_idx" ON "crm_affiliations" USING btree ("tenant_id","person_party_id") WHERE is_primary = true and ended_on is null;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_party_details_tenant_id_id_idx" ON "crm_party_details" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_party_details_tenant_party_idx" ON "crm_party_details" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "crm_party_details_tenant_owner_idx" ON "crm_party_details" USING btree ("tenant_id","owner_clerk_user_id");