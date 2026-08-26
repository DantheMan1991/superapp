ALTER TABLE "retail_prices" ADD COLUMN "price_basis" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD COLUMN "weight_lb" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD COLUMN "line_total_cents" bigint;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_basis_valid" CHECK ("retail_prices"."price_basis" in ('unit', 'lb'));--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_weight_positive" CHECK ("retail_sale_lines"."weight_lb" is null or "retail_sale_lines"."weight_lb" > 0);--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_total_not_negative" CHECK ("retail_sale_lines"."line_total_cents" is null or "retail_sale_lines"."line_total_cents" >= 0);--> statement-breakpoint
ALTER TABLE "retail_sale_lines" ADD CONSTRAINT "retail_sale_lines_weighed_has_total" CHECK ("retail_sale_lines"."weight_lb" is null or "retail_sale_lines"."line_total_cents" is not null);