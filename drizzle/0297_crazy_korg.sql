DROP INDEX "brand_kits_tenant_business_idx";--> statement-breakpoint
DROP INDEX "sites_tenant_idx";--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_tenant_site_idx" ON "brand_kits" USING btree ("tenant_id","site_id") WHERE "brand_kits"."site_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_tenant_business_idx" ON "brand_kits" USING btree ("tenant_id") WHERE "brand_kits"."entity_id" is null and "brand_kits"."site_id" is null;--> statement-breakpoint
CREATE INDEX "sites_tenant_idx" ON "sites" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_one_owner" CHECK ("brand_kits"."entity_id" is null or "brand_kits"."site_id" is null);