-- X8: the rooms in the building, and a measurement that belongs to one.
--
-- THE UNIQUE INDEX ON job_measurements IS REPLACED BY TWO PARTIAL ONES.
-- `room_id` is nullable — null means the measurement is about the whole
-- building — and a plain UNIQUE over (tenant, project, room_id, slug) would
-- treat every NULL as distinct, so the building-level rows would silently be
-- free to duplicate. That is the bug this note exists to prevent on the next
-- regenerate. Two partial indexes instead: one WHERE room_id IS NULL keyed on
-- the project, one WHERE room_id IS NOT NULL keyed on the room.
--
-- The drop and the two creates are in one migration, so there is no window
-- where neither rule holds.

CREATE TABLE "job_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_rooms_name_present" CHECK (length(btrim("job_rooms"."name")) > 0),
	CONSTRAINT "job_rooms_slug_present" CHECK (length(btrim("job_rooms"."slug")) > 0)
);
--> statement-breakpoint
DROP INDEX "job_measurements_tenant_project_slug_idx";--> statement-breakpoint
ALTER TABLE "job_measurements" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "job_rooms" ADD CONSTRAINT "job_rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_rooms" ADD CONSTRAINT "job_rooms_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_rooms_tenant_id_id_idx" ON "job_rooms" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_rooms_tenant_project_slug_idx" ON "job_rooms" USING btree ("tenant_id","project_id","slug");--> statement-breakpoint
CREATE INDEX "job_rooms_tenant_project_sort_idx" ON "job_rooms" USING btree ("tenant_id","project_id","sort_order");--> statement-breakpoint
ALTER TABLE "job_measurements" ADD CONSTRAINT "job_measurements_room_fk" FOREIGN KEY ("tenant_id","room_id") REFERENCES "public"."job_rooms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_measurements_tenant_room_slug_idx" ON "job_measurements" USING btree ("tenant_id","room_id","slug") WHERE "job_measurements"."room_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_measurements_tenant_project_slug_idx" ON "job_measurements" USING btree ("tenant_id","project_id","slug") WHERE "job_measurements"."room_id" is null;