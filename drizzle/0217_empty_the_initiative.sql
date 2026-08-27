CREATE TABLE "livestock_breed_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"livestock_lot_id" uuid NOT NULL,
	"breed" text NOT NULL,
	"parts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_breed_parts_breed_format" CHECK ("livestock_breed_parts"."breed" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "livestock_breed_parts_parts_valid" CHECK ("livestock_breed_parts"."parts" > 0 and "livestock_breed_parts"."parts" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD COLUMN "dam_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD COLUMN "sire_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "livestock_breed_parts" ADD CONSTRAINT "livestock_breed_parts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_breed_parts" ADD CONSTRAINT "livestock_breed_parts_lot_fk" FOREIGN KEY ("tenant_id","livestock_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_breed_parts_tenant_id_id_idx" ON "livestock_breed_parts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_breed_parts_tenant_lot_idx" ON "livestock_breed_parts" USING btree ("tenant_id","livestock_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_breed_parts_tenant_lot_breed_idx" ON "livestock_breed_parts" USING btree ("tenant_id","livestock_lot_id","breed");--> statement-breakpoint
CREATE INDEX "livestock_breed_parts_tenant_breed_idx" ON "livestock_breed_parts" USING btree ("tenant_id","breed");--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_dam_fk" FOREIGN KEY ("tenant_id","dam_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_sire_fk" FOREIGN KEY ("tenant_id","sire_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "livestock_lots_tenant_dam_idx" ON "livestock_lots" USING btree ("tenant_id","dam_lot_id");--> statement-breakpoint
CREATE INDEX "livestock_lots_tenant_sire_idx" ON "livestock_lots" USING btree ("tenant_id","sire_lot_id");--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_dam_not_self" CHECK ("livestock_lots"."dam_lot_id" is null or "livestock_lots"."dam_lot_id" <> "livestock_lots"."id");--> statement-breakpoint
ALTER TABLE "livestock_lots" ADD CONSTRAINT "livestock_lots_sire_not_self" CHECK ("livestock_lots"."sire_lot_id" is null or "livestock_lots"."sire_lot_id" <> "livestock_lots"."id");