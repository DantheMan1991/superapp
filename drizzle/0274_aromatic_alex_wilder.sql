CREATE TABLE "livestock_breeding_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"result" text NOT NULL,
	"days_bred" integer,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_breeding_checks_result_valid" CHECK ("livestock_breeding_checks"."result" in ('bred', 'open', 'lost')),
	CONSTRAINT "livestock_breeding_checks_days_valid" CHECK ("livestock_breeding_checks"."days_bred" is null or ("livestock_breeding_checks"."result" = 'bred' and "livestock_breeding_checks"."days_bred" >= 0 and "livestock_breeding_checks"."days_bred" <= 730))
);
--> statement-breakpoint
CREATE TABLE "livestock_breedings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"sire_lot_id" uuid,
	"exposed_from" date NOT NULL,
	"exposed_to" date,
	"gestation_days" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_breedings_window_forward" CHECK ("livestock_breedings"."exposed_to" is null or "livestock_breedings"."exposed_to" >= "livestock_breedings"."exposed_from"),
	CONSTRAINT "livestock_breedings_gestation_valid" CHECK ("livestock_breedings"."gestation_days" >= 1 and "livestock_breedings"."gestation_days" <= 730),
	CONSTRAINT "livestock_breedings_sire_not_self" CHECK ("livestock_breedings"."sire_lot_id" is null or "livestock_breedings"."sire_lot_id" <> "livestock_breedings"."livestock_lot_id")
);
--> statement-breakpoint
ALTER TABLE "livestock_breeding_checks" ADD CONSTRAINT "livestock_breeding_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_breeding_checks" ADD CONSTRAINT "livestock_breeding_checks_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_breedings" ADD CONSTRAINT "livestock_breedings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_breedings" ADD CONSTRAINT "livestock_breedings_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_breedings" ADD CONSTRAINT "livestock_breedings_sire_fk" FOREIGN KEY ("tenant_id","sire_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_breeding_checks_tenant_id_id_idx" ON "livestock_breeding_checks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_breeding_checks_tenant_lot_day_idx" ON "livestock_breeding_checks" USING btree ("tenant_id","livestock_lot_id","checked_on");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_breedings_tenant_id_id_idx" ON "livestock_breedings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_breedings_tenant_lot_from_idx" ON "livestock_breedings" USING btree ("tenant_id","livestock_lot_id","exposed_from");--> statement-breakpoint
CREATE INDEX "livestock_breedings_tenant_sire_idx" ON "livestock_breedings" USING btree ("tenant_id","sire_lot_id");