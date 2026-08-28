CREATE TABLE "livestock_lot_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_lot_id" uuid NOT NULL,
	"member_lot_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_lot_members_not_self" CHECK ("livestock_lot_members"."member_lot_id" <> "livestock_lot_members"."parent_lot_id"),
	CONSTRAINT "livestock_lot_members_range_ordered" CHECK ("livestock_lot_members"."ended_on" is null or "livestock_lot_members"."ended_on" >= "livestock_lot_members"."started_on")
);
--> statement-breakpoint
ALTER TABLE "livestock_lot_members" ADD CONSTRAINT "livestock_lot_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_lot_members" ADD CONSTRAINT "livestock_lot_members_parent_fk" FOREIGN KEY ("tenant_id","parent_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_lot_members" ADD CONSTRAINT "livestock_lot_members_member_fk" FOREIGN KEY ("tenant_id","member_lot_id") REFERENCES "public"."livestock_lots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_lot_members_tenant_id_id_idx" ON "livestock_lot_members" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_lot_members_tenant_parent_idx" ON "livestock_lot_members" USING btree ("tenant_id","parent_lot_id");--> statement-breakpoint
CREATE INDEX "livestock_lot_members_tenant_member_idx" ON "livestock_lot_members" USING btree ("tenant_id","member_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_lot_members_one_open_idx" ON "livestock_lot_members" USING btree ("tenant_id","member_lot_id") WHERE "livestock_lot_members"."ended_on" is null;