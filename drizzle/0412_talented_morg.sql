-- X8, corrected before it left the branch: a room is unique per FLOOR,
-- not per building. 0410 keyed it on (tenant, project, slug), which would
-- have refused a `Bathroom` upstairs on a house that already had one on
-- the main floor. `level` is NOT NULL with a blank default, so a room with
-- no floor named still has exactly one identity.

DROP INDEX "job_rooms_tenant_project_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "job_rooms_tenant_project_level_slug_idx" ON "job_rooms" USING btree ("tenant_id","project_id","level","slug");