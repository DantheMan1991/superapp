-- Livestock slice 5 — weights as observations carrying a method.
--
-- NO HAND-REORDERING, and that is the rule working rather than an exception to
-- it. drizzle-kit emits every foreign key before every index, which only matters
-- when the FK's target is created in the SAME migration; this table's one
-- composite FK points at `livestock_lots`, which has existed since 0138 and
-- already has its unique index. The rule is *check whether the target is new*,
-- not *always reorder* — sixth check, first time the answer was no.

CREATE TABLE "livestock_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"weighed_on" date NOT NULL,
	"method" text NOT NULL,
	"sample_size" integer DEFAULT 1 NOT NULL,
	"sample_weight_lb" numeric(12, 3),
	"heart_girth_in" numeric(8, 2),
	"body_length_in" numeric(8, 2),
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_weights_method_format" CHECK ("livestock_weights"."method" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "livestock_weights_sample_positive" CHECK ("livestock_weights"."sample_size" > 0),
	CONSTRAINT "livestock_weights_weight_positive" CHECK ("livestock_weights"."sample_weight_lb" is null or "livestock_weights"."sample_weight_lb" > 0),
	CONSTRAINT "livestock_weights_girth_positive" CHECK ("livestock_weights"."heart_girth_in" is null or "livestock_weights"."heart_girth_in" > 0),
	CONSTRAINT "livestock_weights_length_positive" CHECK ("livestock_weights"."body_length_in" is null or "livestock_weights"."body_length_in" > 0),
	CONSTRAINT "livestock_weights_has_a_reading" CHECK ("livestock_weights"."sample_weight_lb" is not null or "livestock_weights"."heart_girth_in" is not null)
);
--> statement-breakpoint
ALTER TABLE "livestock_weights" ADD CONSTRAINT "livestock_weights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_weights" ADD CONSTRAINT "livestock_weights_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_weights_tenant_id_id_idx" ON "livestock_weights" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_weights_tenant_lot_day_idx" ON "livestock_weights" USING btree ("tenant_id","livestock_lot_id","weighed_on");