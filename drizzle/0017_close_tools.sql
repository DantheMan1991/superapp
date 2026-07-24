CREATE TYPE "public"."period_close_status" AS ENUM('completed', 'reopened');--> statement-breakpoint
CREATE TABLE "close_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"close_id" uuid NOT NULL,
	"author_clerk_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"status" "period_close_status" DEFAULT 'completed' NOT NULL,
	"previous_closed_through" date,
	"checklist" jsonb NOT NULL,
	"completed_by_clerk_user_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by_clerk_user_id" text,
	"reopened_at" timestamp with time zone,
	"signed_off_by_clerk_user_id" text,
	"signed_off_at" timestamp with time zone,
	"narrative" jsonb,
	"narrative_generated_at" timestamp with time zone,
	"narrative_model" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "ai_last_narrative_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "books_export_last_at" timestamp with time zone;--> statement-breakpoint
-- Hand-moved before close_notes_close_fk: the composite FK needs this
-- unique index to exist first (0013/0015 precedent).
CREATE UNIQUE INDEX "period_closes_tenant_id_id_idx" ON "period_closes" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "close_notes" ADD CONSTRAINT "close_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_notes" ADD CONSTRAINT "close_notes_close_fk" FOREIGN KEY ("tenant_id","close_id") REFERENCES "public"."period_closes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "close_notes_tenant_id_id_idx" ON "close_notes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "close_notes_tenant_close_idx" ON "close_notes" USING btree ("tenant_id","close_id");--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_tenant_period_completed_idx" ON "period_closes" USING btree ("tenant_id","period_end") WHERE "period_closes"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "period_closes_tenant_idx" ON "period_closes" USING btree ("tenant_id");