/**
 * THE ROOMS IN THE BUILDING (X8).
 *
 * The founder: *"you should identify the rooms on every floor... then the
 * estimate questions can start asking questions like what type of flooring
 * in Master bedroom or what type of shower in master bathroom."* And when
 * asked what a room actually needs to carry: *"the only reason i said we
 * should measure each room is we need to know flooring sq footage."*
 *
 * So a room is **a name, a floor it is on, and a floor area**. Nothing else.
 *
 * ── WHY THE AREA IS NOT A COLUMN HERE ───────────────────────────────────────
 *
 * It is a `job_measurements` row scoped to the room (X7, ADR 0100), which
 * means a room's floor area is read by the same parser that reads `24 x 40`
 * and `38'-6"`, measured with the same *Measure it on a drawing* dialog,
 * carries the same sheet-and-trace provenance, and can be passed the same
 * way. A second `area_thousandths` column here would have been three hundred
 * lines of the same machinery written again — and it would have forced a
 * fourth column the first time somebody wanted a room's wall area too.
 *
 * ── AND THERE IS NO `kind` COLUMN ───────────────────────────────────────────
 *
 * Tempting: a `bathroom` flag would tell the walk to ask about a shower. But
 * *Master bath* already tells it that, and the walk reads the names. A
 * taxonomy is a thing the tenant has to maintain, it would be wrong for
 * commercial the day it shipped, and it buys nothing a name does not.
 *
 * ── THE WORD IS THE TENANT'S ────────────────────────────────────────────────
 *
 * A house has rooms; a fit-out has suites, a warehouse has zones. `level` and
 * `name` are free text and nothing in this file names one.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { jobProjects } from "./jobs";

export const jobRooms = pgTable(
  "job_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** "Master bedroom", "Suite 210", "Bay 3". */
    name: text("name").notNull(),
    /** The name reduced to its identity, unique per building. */
    slug: text("slug").notNull(),
    /** "Main floor", "Basement", "Level 2". Free text, ordered by `sort_order`. */
    level: text("level").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_rooms_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * **ONE ROOM PER NAME PER FLOOR**, not per building. A house can have a
     * `Bathroom` upstairs and a `Bathroom` on the main floor, and a tool
     * that refused the second one would be wrong about houses. `level` is
     * NOT NULL with a blank default, so there is no NULL to be distinct.
     */
    uniqueIndex("job_rooms_tenant_project_level_slug_idx").on(
      t.tenantId,
      t.projectId,
      t.level,
      t.slug,
    ),
    index("job_rooms_tenant_project_sort_idx").on(t.tenantId, t.projectId, t.sortOrder),
    foreignKey({
      name: "job_rooms_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    check("job_rooms_name_present", sql`length(btrim(${t.name})) > 0`),
    check("job_rooms_slug_present", sql`length(btrim(${t.slug})) > 0`),
  ],
);

export type JobRoom = typeof jobRooms.$inferSelect;
