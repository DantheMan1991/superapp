CREATE TABLE "job_party_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"limit_cents" bigint,
	"status" text DEFAULT 'received' NOT NULL,
	"requested_on" date,
	"received_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_party_documents_kind_format" CHECK ("job_party_documents"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "job_party_documents_status_valid" CHECK ("job_party_documents"."status" in ('requested', 'received', 'void')),
	CONSTRAINT "job_party_documents_limit_nonnegative" CHECK ("job_party_documents"."limit_cents" is null or "job_party_documents"."limit_cents" >= 0),
	CONSTRAINT "job_party_documents_received_has_date" CHECK (("job_party_documents"."status" = 'requested' and "job_party_documents"."received_on" is null) or ("job_party_documents"."status" = 'received' and "job_party_documents"."received_on" is not null) or "job_party_documents"."status" = 'void')
);
--> statement-breakpoint
ALTER TABLE "job_party_documents" ADD CONSTRAINT "job_party_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_party_documents" ADD CONSTRAINT "job_party_documents_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_party_documents_tenant_id_id_idx" ON "job_party_documents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_party_documents_tenant_party_idx" ON "job_party_documents" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "job_party_documents_tenant_kind_idx" ON "job_party_documents" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "job_party_documents_tenant_expires_idx" ON "job_party_documents" USING btree ("tenant_id","expires_on");