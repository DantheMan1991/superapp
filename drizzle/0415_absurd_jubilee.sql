ALTER TABLE "job_selections" ADD COLUMN "estimate_group_id" uuid;--> statement-breakpoint
ALTER TABLE "job_assemblies" ADD COLUMN "is_allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_groups" ADD COLUMN "is_allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_estimate_proposed_lines" ADD COLUMN "is_allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_selections" ADD CONSTRAINT "job_selections_estimate_group_fk" FOREIGN KEY ("tenant_id","estimate_group_id") REFERENCES "public"."job_estimate_groups"("tenant_id","id") ON DELETE SET NULL ("estimate_group_id") ON UPDATE no action;