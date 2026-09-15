CREATE TABLE "job_lien_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"commitment_id" uuid,
	"sub_application_id" uuid,
	"kind" text NOT NULL,
	"through_date" date NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_on" date,
	"received_on" date,
	"signed_by" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_lien_waivers_kind_valid" CHECK ("job_lien_waivers"."kind" in ('conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final')),
	CONSTRAINT "job_lien_waivers_status_valid" CHECK ("job_lien_waivers"."status" in ('requested', 'received', 'void')),
	CONSTRAINT "job_lien_waivers_amount_nonnegative" CHECK ("job_lien_waivers"."amount_cents" >= 0),
	CONSTRAINT "job_lien_waivers_received_has_date" CHECK (("job_lien_waivers"."status" = 'requested' and "job_lien_waivers"."received_on" is null) or ("job_lien_waivers"."status" = 'received' and "job_lien_waivers"."received_on" is not null) or "job_lien_waivers"."status" = 'void')
);
--> statement-breakpoint
ALTER TABLE "job_lien_waivers" ADD CONSTRAINT "job_lien_waivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lien_waivers" ADD CONSTRAINT "job_lien_waivers_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lien_waivers" ADD CONSTRAINT "job_lien_waivers_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lien_waivers" ADD CONSTRAINT "job_lien_waivers_commitment_fk" FOREIGN KEY ("tenant_id","commitment_id") REFERENCES "public"."job_commitments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lien_waivers" ADD CONSTRAINT "job_lien_waivers_application_fk" FOREIGN KEY ("tenant_id","sub_application_id") REFERENCES "public"."job_sub_applications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_lien_waivers_tenant_id_id_idx" ON "job_lien_waivers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_lien_waivers_tenant_project_idx" ON "job_lien_waivers" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_lien_waivers_tenant_party_idx" ON "job_lien_waivers" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "job_lien_waivers_tenant_commitment_idx" ON "job_lien_waivers" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "job_lien_waivers_tenant_application_idx" ON "job_lien_waivers" USING btree ("tenant_id","sub_application_id");