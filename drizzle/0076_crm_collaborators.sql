CREATE TABLE "crm_record_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"granted_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_record_collaborators" ADD CONSTRAINT "crm_record_collaborators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_record_collaborators" ADD CONSTRAINT "crm_record_collaborators_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_record_collaborators_tenant_id_id_idx" ON "crm_record_collaborators" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_record_collaborators_unique_idx" ON "crm_record_collaborators" USING btree ("tenant_id","party_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "crm_record_collaborators_party_idx" ON "crm_record_collaborators" USING btree ("tenant_id","party_id");