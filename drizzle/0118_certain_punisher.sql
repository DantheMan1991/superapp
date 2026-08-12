CREATE TYPE "public"."recurring_entry_kind" AS ENUM('journal', 'bill');--> statement-breakpoint
CREATE TABLE "recurring_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "recurring_entry_kind" NOT NULL,
	"name" text NOT NULL,
	"vendor_id" uuid,
	"template" jsonb NOT NULL,
	"day_of_month" integer NOT NULL,
	"next_run_date" date NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_generated_at" timestamp with time zone,
	"created_by_clerk_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_entries_day_of_month" CHECK ("recurring_entries"."day_of_month" between 1 and 28),
	CONSTRAINT "recurring_entries_vendor_shape" CHECK (("recurring_entries"."kind" = 'bill' and "recurring_entries"."vendor_id" is not null)
       or ("recurring_entries"."kind" = 'journal' and "recurring_entries"."vendor_id" is null)),
	CONSTRAINT "recurring_entries_auto_post_shape" CHECK ("recurring_entries"."auto_post" = false or "recurring_entries"."kind" = 'journal')
);
--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_vendor_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_entries_tenant_id_id_idx" ON "recurring_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "recurring_entries_tenant_next_idx" ON "recurring_entries" USING btree ("tenant_id","next_run_date") WHERE "recurring_entries"."is_active" = true;