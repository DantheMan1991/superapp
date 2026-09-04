ALTER TABLE "brand_kits" ADD COLUMN "logo_source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "logo_spec" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_source_values" CHECK ("brand_kits"."logo_source" in ('upload', 'generated'));