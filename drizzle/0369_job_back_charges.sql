CREATE TABLE "job_back_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"cost_code_id" uuid,
	"incurred_on" date NOT NULL,
	"warranty_claim_id" uuid,
	"sub_application_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_back_charges_number_positive" CHECK ("job_back_charges"."number" > 0),
	CONSTRAINT "job_back_charges_amount_positive" CHECK ("job_back_charges"."amount_cents" > 0),
	CONSTRAINT "job_back_charges_description_present" CHECK (length(btrim("job_back_charges"."description")) > 0),
	CONSTRAINT "job_back_charges_status_valid" CHECK ("job_back_charges"."status" in ('open', 'void')),
	CONSTRAINT "job_back_charges_void_is_off" CHECK ("job_back_charges"."status" = 'open' or "job_back_charges"."sub_application_id" is null),
	CONSTRAINT "job_back_charges_description_bounded" CHECK (char_length("job_back_charges"."description") <= 300),
	CONSTRAINT "job_back_charges_void_reason_bounded" CHECK (char_length("job_back_charges"."void_reason") <= 2000),
	CONSTRAINT "job_back_charges_notes_bounded" CHECK (char_length("job_back_charges"."notes") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "job_back_charges" ADD CONSTRAINT "job_back_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_back_charges" ADD CONSTRAINT "job_back_charges_commitment_fk" FOREIGN KEY ("tenant_id","commitment_id") REFERENCES "public"."job_commitments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, the mail_links precedent in 0046): a bare SET NULL would try to
-- null tenant_id too and can never run on a composite key. A code retired, a claim removed or a DRAFT
-- application deleted each leave the back-charge standing (ADR 0077).
ALTER TABLE "job_back_charges" ADD CONSTRAINT "job_back_charges_cost_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE SET NULL ("cost_code_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_back_charges" ADD CONSTRAINT "job_back_charges_claim_fk" FOREIGN KEY ("tenant_id","warranty_claim_id") REFERENCES "public"."job_warranty_claims"("tenant_id","id") ON DELETE SET NULL ("warranty_claim_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_back_charges" ADD CONSTRAINT "job_back_charges_application_fk" FOREIGN KEY ("tenant_id","sub_application_id") REFERENCES "public"."job_sub_applications"("tenant_id","id") ON DELETE SET NULL ("sub_application_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_back_charges_tenant_id_id_idx" ON "job_back_charges" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_back_charges_number_idx" ON "job_back_charges" USING btree ("tenant_id","commitment_id","number");--> statement-breakpoint
CREATE INDEX "job_back_charges_tenant_commitment_idx" ON "job_back_charges" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "job_back_charges_tenant_application_idx" ON "job_back_charges" USING btree ("tenant_id","sub_application_id");--> statement-breakpoint
CREATE INDEX "job_back_charges_tenant_claim_idx" ON "job_back_charges" USING btree ("tenant_id","warranty_claim_id");