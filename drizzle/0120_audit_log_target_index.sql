-- The per-record history panel is the first read of audit_log that filters by
-- TARGET rather than by tenant or time. Without this index that query scans
-- every audit row the tenant has ever written, on a table that only grows and
-- is never pruned.
--
-- Numbered 0120 rather than 0118 on purpose: PRs #137 (recurring entries) and
-- this one were open at the same time, and #137 already claims 0118 and 0119.
-- Drizzle applies migrations in journal order, so the numbering gap is
-- cosmetic; a collision would not have been.

CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("tenant_id","target_type","target_id","created_at");
