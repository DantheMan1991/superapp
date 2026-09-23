ALTER TABLE "job_sheet_markups" DROP CONSTRAINT "job_sheet_markups_line_fk";
--> statement-breakpoint
DROP INDEX "job_sheet_markups_tenant_line_idx";--> statement-breakpoint
ALTER TABLE "job_sheet_markups" DROP COLUMN "estimate_line_id";--> statement-breakpoint
ALTER TABLE "job_sheet_markups" DROP COLUMN "pushed_quantity_thousandths";