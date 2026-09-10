CREATE TABLE "operator_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"stripe_object_id" text NOT NULL,
	"client_tenant_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"invoice_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_postings" ADD CONSTRAINT "operator_postings_client_tenant_id_tenants_id_fk" FOREIGN KEY ("client_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_postings_stripe_idx" ON "operator_postings" USING btree ("stripe_object_id");--> statement-breakpoint
CREATE INDEX "operator_postings_status_idx" ON "operator_postings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operator_postings_client_idx" ON "operator_postings" USING btree ("client_tenant_id");