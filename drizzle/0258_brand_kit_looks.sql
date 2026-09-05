ALTER TABLE "brand_kits" ADD COLUMN "look" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "font_pairing" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "button_shape" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_look_values" CHECK ("brand_kits"."look" in ('', 'modern', 'warm', 'classic'));--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_font_pairing_values" CHECK ("brand_kits"."font_pairing" in ('', 'clean', 'warm', 'classic', 'bold', 'friendly', 'elegant'));--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_button_shape_values" CHECK ("brand_kits"."button_shape" in ('', 'pill', 'rounded', 'square'));