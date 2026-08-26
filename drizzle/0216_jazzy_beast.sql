ALTER TABLE "inventory_items" ADD COLUMN "enterprise_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "enterprise_id" uuid;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "enterprise_id" uuid;--> statement-breakpoint
ALTER TABLE "retail_channels" ADD COLUMN "enterprise_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_enterprise_fk" FOREIGN KEY ("tenant_id","enterprise_id") REFERENCES "public"."enterprises"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_enterprise_fk" FOREIGN KEY ("tenant_id","enterprise_id") REFERENCES "public"."enterprises"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_enterprise_fk" FOREIGN KEY ("tenant_id","enterprise_id") REFERENCES "public"."enterprises"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_channels" ADD CONSTRAINT "retail_channels_enterprise_fk" FOREIGN KEY ("tenant_id","enterprise_id") REFERENCES "public"."enterprises"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_enterprise_idx" ON "inventory_items" USING btree ("tenant_id","enterprise_id");--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_enterprise_idx" ON "inventory_lots" USING btree ("tenant_id","enterprise_id");--> statement-breakpoint
CREATE INDEX "production_runs_tenant_enterprise_idx" ON "production_runs" USING btree ("tenant_id","enterprise_id");--> statement-breakpoint
CREATE INDEX "retail_channels_tenant_enterprise_idx" ON "retail_channels" USING btree ("tenant_id","enterprise_id");