CREATE TABLE "job_assembly_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"key" text NOT NULL,
	"key_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_assembly_keys_key_present" CHECK (length(btrim("job_assembly_keys"."key")) > 0),
	CONSTRAINT "job_assembly_keys_slug_present" CHECK (length(btrim("job_assembly_keys"."key_slug")) > 0)
);
--> statement-breakpoint
ALTER TABLE "job_assembly_keys" ADD CONSTRAINT "job_assembly_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assembly_keys" ADD CONSTRAINT "job_assembly_keys_assembly_fk" FOREIGN KEY ("tenant_id","assembly_id") REFERENCES "public"."job_assemblies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_assembly_keys_tenant_id_id_idx" ON "job_assembly_keys" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_assembly_keys_tenant_slug_idx" ON "job_assembly_keys" USING btree ("tenant_id","key_slug");--> statement-breakpoint
CREATE INDEX "job_assembly_keys_tenant_assembly_idx" ON "job_assembly_keys" USING btree ("tenant_id","assembly_id");