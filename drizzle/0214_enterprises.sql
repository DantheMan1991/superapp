CREATE TABLE "enterprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprises_name_present" CHECK (length(btrim("enterprises"."name")) > 0),
	CONSTRAINT "enterprises_slug_format" CHECK ("enterprises"."slug" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "enterprises_kind_format" CHECK ("enterprises"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "enterprises_status_valid" CHECK ("enterprises"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_tenant_id_id_idx" ON "enterprises" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_tenant_slug_idx" ON "enterprises" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "enterprises_tenant_status_idx" ON "enterprises" USING btree ("tenant_id","status");