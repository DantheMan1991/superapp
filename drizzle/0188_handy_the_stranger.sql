CREATE TABLE "production_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"booked_for" date NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"head_count" integer,
	"status" text DEFAULT 'held' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"deposit_cents" integer,
	"deposit_paid_on" date,
	"run_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_bookings_status_valid" CHECK ("production_bookings"."status" in ('held', 'confirmed', 'cancelled')),
	CONSTRAINT "production_bookings_head_positive" CHECK ("production_bookings"."head_count" is null or "production_bookings"."head_count" > 0),
	CONSTRAINT "production_bookings_deposit_nonneg" CHECK ("production_bookings"."deposit_cents" is null or "production_bookings"."deposit_cents" >= 0),
	CONSTRAINT "production_bookings_kind_format" CHECK ("production_bookings"."kind" = '' or "production_bookings"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_bookings_cancelled_has_no_run" CHECK ("production_bookings"."status" <> 'cancelled' or "production_bookings"."run_id" is null)
);
--> statement-breakpoint
ALTER TABLE "production_bookings" ADD CONSTRAINT "production_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bookings" ADD CONSTRAINT "production_bookings_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_bookings" ADD CONSTRAINT "production_bookings_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_bookings_tenant_id_id_idx" ON "production_bookings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_bookings_tenant_date_idx" ON "production_bookings" USING btree ("tenant_id","booked_for");--> statement-breakpoint
CREATE INDEX "production_bookings_tenant_processor_idx" ON "production_bookings" USING btree ("tenant_id","processor_id");