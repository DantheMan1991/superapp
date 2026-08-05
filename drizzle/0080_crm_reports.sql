CREATE TABLE "crm_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_clerk_user_id" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_reports" ADD CONSTRAINT "crm_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_reports_tenant_id_id_idx" ON "crm_reports" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "crm_reports_tenant_idx" ON "crm_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_reports_name_idx" ON "crm_reports" USING btree ("tenant_id","owner_clerk_user_id","name");