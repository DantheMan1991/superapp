CREATE TABLE "document_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"extension_slug" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_attachments_entity_type_format" CHECK ("document_attachments"."entity_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "document_attachments_extension_slug_format" CHECK ("document_attachments"."extension_slug" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_attachments_tenant_id_id_idx" ON "document_attachments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "document_attachments_tenant_document_idx" ON "document_attachments" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_attachments_unique_idx" ON "document_attachments" USING btree ("tenant_id","document_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "document_attachments_entity_idx" ON "document_attachments" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_attachments_primary_idx" ON "document_attachments" USING btree ("tenant_id","entity_type","entity_id") WHERE "document_attachments"."is_primary";