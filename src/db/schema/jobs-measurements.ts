/**
 * THE HOUSE'S OWN NUMBERS (X7).
 *
 * The founder, after walking a real bid: *"What if before the questions it
 * prompts you to grab measurements. Full exterior elevation square footage,
 * wall square footage, wall perimeter etc. Then the questions can use this
 * information as it goes."*
 *
 * ── WHY THEY ARE A TABLE AND NOT ANSWERS ────────────────────────────────────
 *
 * An answer belongs to a question on a step, and it falls out of the walk's
 * context after thirty of them — which is why a walk that was told 2,400
 * square feet at framing has forgotten it by drywall. A MEASUREMENT belongs
 * to the building. It is a handful of rows, it fits in every prompt from the
 * first phase to the last, and every question after it can do arithmetic
 * from it. That is the whole reason this exists: **the walk stops
 * re-asking for numbers it was already given.**
 *
 * ── THEY HANG OFF THE PROJECT, NOT THE ESTIMATE ─────────────────────────────
 *
 * The wall perimeter does not change between revision one and revision four,
 * and it does not change because somebody started a second walk. Measure the
 * building once and every estimate on it reads the same numbers.
 *
 * ── WHAT TO MEASURE IS THE TENANT'S, LIKE EVERYTHING ELSE HERE ──────────────
 *
 * `job_estimate_outline_measures` is the list, and it lives on the outline
 * beside the steps and the questions because it is the same kind of thing: a
 * remodel wants different numbers from a new build, and a commercial shell
 * wants different ones again. Nothing in this file names a measurement.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { jobSheets } from "./jobs-drawings";
import { jobSheetMarkups } from "./jobs-markups";
import { jobRooms } from "./jobs-rooms";

/**
 * Where a number came from, which is the same discipline the estimate lines
 * keep: a figure you cannot trace is a figure nobody will defend.
 *
 * - `measured` — traced on a drawing, through that sheet's scale.
 * - `said` — somebody typed it. A tape measure and a notepad is most
 *   remodels, so this is not the lesser case.
 * - `derived` — worked out from other measurements, with the working in
 *   `note`. Nothing writes this yet; the column allows it so the walk can
 *   start showing its arithmetic without a migration.
 */
export const MEASUREMENT_SOURCES = ["measured", "said", "derived"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/**
 * ONE NUMBER ABOUT THE BUILDING: "Wall perimeter, 248 lf".
 *
 * `slug` is the identity, not `name` — so the list can be reworded without
 * orphaning what was measured, and so two outlines asking for *Wall
 * perimeter* and *wall perimeter* are asking for one thing. It is unique per
 * project, which is what makes a measurement a fact about the building
 * rather than a fact about a walk.
 *
 * **A PASS IS A REAL ANSWER.** `passed_at` with no value is somebody saying
 * *not on this job* or *I will get it later*, and it sticks, exactly as a
 * passed price does (X6) — without it the walk asks the same thing every
 * time it comes past. The CHECK below is the rule: a row carries a number or
 * a pass, never neither.
 */
export const jobMeasurements = pgTable(
  "job_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /**
     * **THE ROOM THIS IS ABOUT, WHEN IT IS ABOUT ONE** (X8). Null for a
     * measurement of the whole building — the perimeter, the roof.
     *
     * This is what lets a room's floor area be an ordinary measurement
     * rather than a column on `job_rooms`: the same parser reads it, the
     * same dialog measures it off a drawing, the same sheet and trace sit
     * beside it. Adding a room's WALL area later is then a row, not a
     * migration.
     */
    roomId: uuid("room_id"),
    /** As it is written and read: "Wall perimeter", "Roof area". */
    name: text("name").notNull(),
    /** The name reduced to its identity. Unique per project. */
    slug: text("slug").notNull(),
    /** "lf", "sf", "cy", "ea" — free text, as every unit in this pack is. */
    unit: text("unit").notNull().default(""),
    /** Thousandths, the pack's quantity scale (ADR 0064). Null when passed. */
    valueThousandths: bigint("value_thousandths", { mode: "number" }),
    source: text("source").notNull().default("said"),
    /** Where on the drawings, what was included, or the working. */
    note: text("note").notNull().default(""),
    /** Not on this job, or not known yet. */
    passedAt: timestamp("passed_at", { withTimezone: true }),
    /**
     * The sheet it was traced on and the markup that is the trace, so the
     * number can be shown where it came from and re-read when the scale is
     * corrected. Both null on a number somebody typed.
     *
     * SET NULL on a composite FK needs PG 15's column-list form; a bare one
     * can never run (`docs/modules/jobs.md`, and the platform doc says why).
     * A deleted markup must not take the measurement with it — the number
     * was still true when it was taken.
     */
    sheetId: uuid("sheet_id"),
    markupId: uuid("markup_id"),
    takenByClerkUserId: text("taken_by_clerk_user_id"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_measurements_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * **ONE VALUE PER NAME, PER ROOM OR PER BUILDING** — two partial unique
     * indexes rather than one over four columns, because a plain unique
     * index treats NULLs as distinct and the building-level rows would have
     * been free to duplicate. (PG 15's `NULLS NOT DISTINCT` would also do
     * it; two partial indexes say which case is which, and the pack already
     * uses the shape for the one-default rule.)
     */
    uniqueIndex("job_measurements_tenant_project_slug_idx")
      .on(t.tenantId, t.projectId, t.slug)
      .where(sql`${t.roomId} is null`),
    uniqueIndex("job_measurements_tenant_room_slug_idx")
      .on(t.tenantId, t.roomId, t.slug)
      .where(sql`${t.roomId} is not null`),
    index("job_measurements_tenant_project_idx").on(t.tenantId, t.projectId),
    foreignKey({
      name: "job_measurements_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** The area belonged to the room; it goes when the room does. */
    foreignKey({
      name: "job_measurements_room_fk",
      columns: [t.tenantId, t.roomId],
      foreignColumns: [jobRooms.tenantId, jobRooms.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_measurements_sheet_fk",
      columns: [t.tenantId, t.sheetId],
      foreignColumns: [jobSheets.tenantId, jobSheets.id],
    }).onDelete("set null"),
    foreignKey({
      name: "job_measurements_markup_fk",
      columns: [t.tenantId, t.markupId],
      foreignColumns: [jobSheetMarkups.tenantId, jobSheetMarkups.id],
    }).onDelete("set null"),
    check("job_measurements_name_present", sql`length(btrim(${t.name})) > 0`),
    check("job_measurements_slug_present", sql`length(btrim(${t.slug})) > 0`),
    check(
      "job_measurements_source_valid",
      sql`${t.source} in ('measured', 'said', 'derived')`,
    ),
    /** A number or a pass. A row that is neither is a question nobody answered. */
    check(
      "job_measurements_answered",
      sql`${t.valueThousandths} is not null or ${t.passedAt} is not null`,
    ),
  ],
);

export type JobMeasurement = typeof jobMeasurements.$inferSelect;
