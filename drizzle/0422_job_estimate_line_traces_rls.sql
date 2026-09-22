-- job_estimate_line_traces: RLS, and the links the takeoff already made
-- (ADR 0110). Pattern per docs/security.md — the superadmin policy for the
-- god view, the member policy for the tenant's own rows. A trace now stands
-- behind an estimate line through this table, one row per (line, trace,
-- figure), so one room traced once can feed the flooring by its area and the
-- baseboard by its perimeter; the two columns it replaces on
-- job_sheet_markups stay in place, unread, until a later migration drops them.
ALTER TABLE "job_estimate_line_traces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_estimate_line_traces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_estimate_line_traces_superadmin_all ON "job_estimate_line_traces"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY job_estimate_line_traces_member_all ON "job_estimate_line_traces"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
-- Every link the first takeoff made, carried across: the trace's own kind is
-- the figure, and what it pushed is its share (its own, since #663).
INSERT INTO "job_estimate_line_traces" ("tenant_id", "line_id", "markup_id", "figure", "share_thousandths")
SELECT m."tenant_id", m."estimate_line_id", m."id", m."kind", coalesce(m."pushed_quantity_thousandths", 0)
FROM "job_sheet_markups" m
WHERE m."estimate_line_id" IS NOT NULL
  AND m."kind" IN ('length', 'area', 'count')
ON CONFLICT DO NOTHING;
