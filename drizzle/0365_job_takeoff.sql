-- The takeoff (ADR 0074): the scale on the sheet, the measuring kinds on the markups, and the estimate line a
-- measurement fed. No new table, so no new policy: job_sheets and job_sheet_markups keep theirs.
ALTER TABLE "job_sheet_markups" DROP CONSTRAINT "job_sheet_markups_kind_valid";--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "scale_points_per_unit" double precision;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "scale_unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "page_width_pt" double precision;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "page_height_pt" double precision;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "scale_set_by_clerk_user_id" text;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD COLUMN "scale_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD COLUMN "estimate_line_id" uuid;--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD COLUMN "pushed_quantity_thousandths" bigint;--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, as 0363's punch-item key and 0046's mail links): a bare SET NULL would
-- try to null tenant_id too. A line taken off the estimate leaves the measurement on the sheet, unpushed (ADR 0074).
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_line_fk" FOREIGN KEY ("tenant_id","estimate_line_id") REFERENCES "public"."job_estimate_lines"("tenant_id","id") ON DELETE SET NULL ("estimate_line_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_sheet_markups_tenant_line_idx" ON "job_sheet_markups" USING btree ("tenant_id","estimate_line_id");--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_scale_positive" CHECK ("job_sheets"."scale_points_per_unit" is null or "job_sheets"."scale_points_per_unit" > 0);--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_scale_unit_valid" CHECK ("job_sheets"."scale_unit" in ('', 'ft', 'm'));--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_scale_whole" CHECK (("job_sheets"."scale_points_per_unit" is null and "job_sheets"."scale_unit" = '') or ("job_sheets"."scale_points_per_unit" is not null and "job_sheets"."scale_unit" <> '' and "job_sheets"."page_width_pt" > 0 and "job_sheets"."page_height_pt" > 0));--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_kind_valid" CHECK ("job_sheet_markups"."kind" in ('cloud', 'arrow', 'text', 'pin', 'length', 'area', 'count'));