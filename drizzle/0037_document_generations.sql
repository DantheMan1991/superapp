-- The generation record. Split from 0036 because that file adds the
-- 'generated' enum value and a new value cannot be used in the transaction
-- that introduces it.
--
-- Safe against the running code: a brand-new table nothing already deployed
-- reads or writes (the 0025 lesson).
--
-- Note the index/FK ordering — the (tenant_id, id) unique must exist before
-- anything references it. 0033 lost a DIFFERENT index to a careless hand edit,
-- so this file is written in dependency order from the start rather than
-- generated and then shuffled.
CREATE TABLE "document_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version_no" integer NOT NULL,
	"template_version_id" uuid,
	"document_id" uuid,
	"number" integer NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_generations_number_positive" CHECK ("document_generations"."number" >= 1),
	CONSTRAINT "document_generations_version_positive" CHECK ("document_generations"."template_version_no" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_generations_tenant_id_id_idx" ON "document_generations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_generations_tenant_number_idx" ON "document_generations" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "document_generations_tenant_template_idx" ON "document_generations" USING btree ("tenant_id","template_id","created_at");--> statement-breakpoint
ALTER TABLE "document_generations" ADD CONSTRAINT "document_generations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_generations" ADD CONSTRAINT "document_generations_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."document_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NO ACTION and a nullable document_id on purpose: a document can be trashed,
-- and the record that it was ever produced must outlive that.
ALTER TABLE "document_generations" ADD CONSTRAINT "document_generations_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
