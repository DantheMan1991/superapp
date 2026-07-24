CREATE TABLE "retainer_allotments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_month" text NOT NULL,
	"included_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_allotments_month_format" CHECK ("retainer_allotments"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "retainer_allotments_nonnegative" CHECK ("retainer_allotments"."included_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retainer_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text NOT NULL,
	"block_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_purchases_minutes_positive" CHECK ("retainer_purchases"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "retainer_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"work_date" date NOT NULL,
	"note" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"actor_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_time_entries_minutes_positive" CHECK ("retainer_time_entries"."minutes" > 0),
	CONSTRAINT "retainer_time_entries_source" CHECK ("retainer_time_entries"."source" in ('manual', 'timer'))
);
--> statement-breakpoint
CREATE TABLE "retainers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"included_minutes_monthly" integer DEFAULT 0 NOT NULL,
	"timer_started_at" timestamp with time zone,
	"timer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainers_included_nonnegative" CHECK ("retainers"."included_minutes_monthly" >= 0)
);
--> statement-breakpoint
ALTER TABLE "retainer_allotments" ADD CONSTRAINT "retainer_allotments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_purchases" ADD CONSTRAINT "retainer_purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_time_entries" ADD CONSTRAINT "retainer_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_allotments_tenant_month_idx" ON "retainer_allotments" USING btree ("tenant_id","effective_month");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_purchases_session_idx" ON "retainer_purchases" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "retainer_purchases_tenant_idx" ON "retainer_purchases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "retainer_time_entries_tenant_date_idx" ON "retainer_time_entries" USING btree ("tenant_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "retainers_tenant_idx" ON "retainers" USING btree ("tenant_id");