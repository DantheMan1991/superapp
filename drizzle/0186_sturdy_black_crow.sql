CREATE TABLE "production_processor_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_processor_cuts_name_present" CHECK (length(btrim("production_processor_cuts"."name")) > 0),
	CONSTRAINT "production_processor_cuts_kind_format" CHECK ("production_processor_cuts"."kind" = '' or "production_processor_cuts"."kind" ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "production_processor_handles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"capacity_per_day" integer,
	"kill_fee_cents" integer,
	"cut_wrap_cents_per_lb" integer,
	"price_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_processor_handles_kind_format" CHECK ("production_processor_handles"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "production_processor_handles_capacity_positive" CHECK ("production_processor_handles"."capacity_per_day" is null or "production_processor_handles"."capacity_per_day" > 0),
	CONSTRAINT "production_processor_handles_kill_fee_nonneg" CHECK ("production_processor_handles"."kill_fee_cents" is null or "production_processor_handles"."kill_fee_cents" >= 0),
	CONSTRAINT "production_processor_handles_cut_wrap_nonneg" CHECK ("production_processor_handles"."cut_wrap_cents_per_lb" is null or "production_processor_handles"."cut_wrap_cents_per_lb" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_processors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"inspection" text DEFAULT 'unknown' NOT NULL,
	"establishment_number" text DEFAULT '' NOT NULL,
	"custom_labelling" text DEFAULT 'unknown' NOT NULL,
	"labelling_notes" text DEFAULT '' NOT NULL,
	"lead_time_days" integer,
	"rating" integer,
	"good_at" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_processors_inspection_valid" CHECK ("production_processors"."inspection" in ('usda', 'state', 'custom_exempt', 'uninspected', 'unknown')),
	CONSTRAINT "production_processors_labelling_valid" CHECK ("production_processors"."custom_labelling" in ('unknown', 'no', 'yes')),
	CONSTRAINT "production_processors_rating_range" CHECK ("production_processors"."rating" is null or ("production_processors"."rating" >= 1 and "production_processors"."rating" <= 5)),
	CONSTRAINT "production_processors_lead_time_positive" CHECK ("production_processors"."lead_time_days" is null or "production_processors"."lead_time_days" > 0)
);
--> statement-breakpoint
-- HAND-REORDERED, and the generator will do this again.
--
-- drizzle-kit emits every CREATE TABLE, then every FOREIGN KEY, then every
-- index. That order is wrong whenever a new table references another NEW
-- table on (tenant_id, id): the composite FK needs a UNIQUE index on those
-- two columns, and the only unique thing on the fresh table is the primary
-- key on id alone. Postgres refuses with "there is no unique constraint
-- matching given keys for referenced table", and the whole migration rolls
-- back.
--
-- So this one index is lifted above the constraint block. It was caught by
-- replaying the file against a database inside a transaction before merging,
-- which is the check worth repeating: 0184 was asked the same question and
-- the answer was no, because both of ITS targets already existed.
CREATE UNIQUE INDEX "production_processors_tenant_id_id_idx" ON "production_processors" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "production_processor_cuts" ADD CONSTRAINT "production_processor_cuts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processor_cuts" ADD CONSTRAINT "production_processor_cuts_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processor_handles" ADD CONSTRAINT "production_processor_handles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processor_handles" ADD CONSTRAINT "production_processor_handles_processor_fk" FOREIGN KEY ("tenant_id","processor_id") REFERENCES "public"."production_processors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processors" ADD CONSTRAINT "production_processors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processors" ADD CONSTRAINT "production_processors_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_cuts_tenant_id_id_idx" ON "production_processor_cuts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_processor_cuts_processor_idx" ON "production_processor_cuts" USING btree ("tenant_id","processor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_handles_tenant_id_id_idx" ON "production_processor_handles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_processor_handles_unique_idx" ON "production_processor_handles" USING btree ("tenant_id","processor_id","kind");--> statement-breakpoint
CREATE INDEX "production_processor_handles_kind_idx" ON "production_processor_handles" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "production_processors_tenant_party_idx" ON "production_processors" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "production_processors_tenant_idx" ON "production_processors" USING btree ("tenant_id");