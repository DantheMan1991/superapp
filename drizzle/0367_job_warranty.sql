CREATE TABLE "job_warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"reported_on" date NOT NULL,
	"reported_by" text DEFAULT '' NOT NULL,
	"party_id" uuid,
	"cost_code_id" uuid,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decision_note" text DEFAULT '' NOT NULL,
	"decided_on" date,
	"work_item_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_warranty_claims_number_positive" CHECK ("job_warranty_claims"."number" > 0),
	CONSTRAINT "job_warranty_claims_title_present" CHECK (length(btrim("job_warranty_claims"."title")) > 0),
	CONSTRAINT "job_warranty_claims_decision_valid" CHECK ("job_warranty_claims"."decision" in ('pending', 'covered', 'not_covered')),
	CONSTRAINT "job_warranty_claims_decision_dated" CHECK (("job_warranty_claims"."decision" = 'pending') = ("job_warranty_claims"."decided_on" is null)),
	CONSTRAINT "job_warranty_claims_title_bounded" CHECK (char_length("job_warranty_claims"."title") <= 300),
	CONSTRAINT "job_warranty_claims_location_bounded" CHECK (char_length("job_warranty_claims"."location") <= 300),
	CONSTRAINT "job_warranty_claims_reported_by_bounded" CHECK (char_length("job_warranty_claims"."reported_by") <= 200),
	CONSTRAINT "job_warranty_claims_decision_note_bounded" CHECK (char_length("job_warranty_claims"."decision_note") <= 2000),
	CONSTRAINT "job_warranty_claims_notes_bounded" CHECK (char_length("job_warranty_claims"."notes") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "job_projects" ADD COLUMN "warranty_months" integer;--> statement-breakpoint
ALTER TABLE "job_projects" ADD COLUMN "substantial_completion_on" date;--> statement-breakpoint
ALTER TABLE "job_warranty_claims" ADD CONSTRAINT "job_warranty_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_warranty_claims" ADD CONSTRAINT "job_warranty_claims_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_warranty_claims" ADD CONSTRAINT "job_warranty_claims_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, the mail_links precedent in 0046): a bare SET NULL would try to
-- null tenant_id too and can never run on a composite key. A code removed leaves the claim; a work item cleared
-- from Work leaves the claim as the record of the call (ADR 0076).
ALTER TABLE "job_warranty_claims" ADD CONSTRAINT "job_warranty_claims_cost_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE SET NULL ("cost_code_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_warranty_claims" ADD CONSTRAINT "job_warranty_claims_work_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE SET NULL ("work_item_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_warranty_claims_tenant_id_id_idx" ON "job_warranty_claims" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_warranty_claims_number_idx" ON "job_warranty_claims" USING btree ("tenant_id","project_id","number");--> statement-breakpoint
CREATE INDEX "job_warranty_claims_tenant_project_idx" ON "job_warranty_claims" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_warranty_claims_tenant_work_idx" ON "job_warranty_claims" USING btree ("tenant_id","work_item_id");--> statement-breakpoint
CREATE INDEX "job_warranty_claims_tenant_party_idx" ON "job_warranty_claims" USING btree ("tenant_id","party_id");--> statement-breakpoint
ALTER TABLE "job_projects" ADD CONSTRAINT "job_projects_warranty_months_whole" CHECK (coalesce("job_projects"."warranty_months", 1) between 1 and 1200);