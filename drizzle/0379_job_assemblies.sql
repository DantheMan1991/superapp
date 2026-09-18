-- Assemblies: an item, saved, so the next job can have it too (E6, ADR 0086).
--
-- HAND-REORDERED, and it would not run otherwise. drizzle generated every
-- foreign key before every index, so `job_assembly_lines_assembly_fk` — which
-- references `job_assemblies (tenant_id, id)` — landed before the unique index
-- that makes those columns a legal target. Postgres refuses a composite FK
-- with no unique constraint behind it, so the parent's unique index is moved
-- ahead of the child's key here, exactly as 0356 and 0352 had to be.

CREATE TABLE "job_assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"client_note" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"driving_quantity_thousandths" bigint DEFAULT 1000 NOT NULL,
	"driving_unit" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_assemblies_name_present" CHECK (length(btrim("job_assemblies"."name")) > 0),
	CONSTRAINT "job_assemblies_driving_positive" CHECK ("job_assemblies"."driving_quantity_thousandths" > 0)
);
--> statement-breakpoint
CREATE TABLE "job_assembly_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"description" text NOT NULL,
	"client_description" text DEFAULT '' NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity_thousandths" bigint DEFAULT 1000 NOT NULL,
	"unit_cost_cents" bigint DEFAULT 0 NOT NULL,
	"markup_ppm" integer,
	"unit_price_cents" bigint,
	"cost_code" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_assembly_lines_description_present" CHECK (length(btrim("job_assembly_lines"."description")) > 0),
	CONSTRAINT "job_assembly_lines_quantity_nonnegative" CHECK ("job_assembly_lines"."quantity_thousandths" >= 0),
	CONSTRAINT "job_assembly_lines_unit_cost_nonnegative" CHECK ("job_assembly_lines"."unit_cost_cents" >= 0),
	CONSTRAINT "job_assembly_lines_unit_price_nonnegative" CHECK ("job_assembly_lines"."unit_price_cents" is null or "job_assembly_lines"."unit_price_cents" >= 0),
	CONSTRAINT "job_assembly_lines_markup_range" CHECK ("job_assembly_lines"."markup_ppm" is null or ("job_assembly_lines"."markup_ppm" >= 0 and "job_assembly_lines"."markup_ppm" <= 10000000))
);
--> statement-breakpoint
ALTER TABLE "job_assemblies" ADD CONSTRAINT "job_assemblies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assembly_lines" ADD CONSTRAINT "job_assembly_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- MOVED UP: the composite key below has nothing to reference without it.
CREATE UNIQUE INDEX "job_assemblies_tenant_id_id_idx" ON "job_assemblies" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_assembly_lines" ADD CONSTRAINT "job_assembly_lines_assembly_fk" FOREIGN KEY ("tenant_id","assembly_id") REFERENCES "public"."job_assemblies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_assemblies_tenant_name_idx" ON "job_assemblies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "job_assembly_lines_tenant_id_id_idx" ON "job_assembly_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_assembly_lines_tenant_assembly_idx" ON "job_assembly_lines" USING btree ("tenant_id","assembly_id");
