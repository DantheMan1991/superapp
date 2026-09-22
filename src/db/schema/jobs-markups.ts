import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobSheets } from "./jobs-drawings";
import { jobEstimateLines } from "./jobs-estimates";
import { jobProjects } from "./jobs";
import { tenants } from "./platform";
import { workItems } from "./work";

/**
 * A markup on a sheet (ADR 0073): a cloud, an arrow, a note or a pin, drawn
 * over one ISSUE of a sheet and stored as a vector in fractions of the page,
 * so it lands in the same place at any zoom and on any screen and the PDF's
 * bytes are never touched.
 *
 * A PIN IS A PUNCH ITEM WHERE IT SITS. Raising one makes an ordinary Work
 * item linked to the job — the same row the job's punch list and the daily
 * digest show — and the pin remembers it in `work_item_id`. The key to
 * `work_items` SETS NULL (column-list form, the mail_links precedent) rather
 * than cascading: a punch item cleared from Work leaves the pin as a note,
 * and a pin deleted leaves the punch item alone, because the item has a life
 * of its own the day it is raised.
 *
 * A markup belongs to the sheet row, which is one issue; a reissued sheet
 * starts clean, and the page says what the earlier issue carried.
 */
export const jobSheetMarkups = pgTable(
  "job_sheet_markups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    sheetId: uuid("sheet_id").notNull(),
    /** cloud | arrow | text | pin, and the measuring kinds length | area | count — `MARKUP_KINDS`. */
    kind: text("kind").notNull(),
    /** red | blue | green | yellow | black — `MARKUP_COLORS`. */
    color: text("color").notNull().default("red"),
    /** Fractions of the page: a cloud {x,y,w,h}, an arrow {x1,y1,x2,y2}, a note or a pin {x,y}. Parsed by `parseGeometry`. */
    geometry: jsonb("geometry").notNull(),
    /** The note, or what the pin needs doing. Required for a note and a pin. */
    text: text("text").notNull().default(""),
    /** The punch item a pin raised, while it exists. */
    workItemId: uuid("work_item_id"),
    /**
     * THE FIGURES A TRACE CARRIES BESIDES ITS POINTS (ADR 0110): what the
     * trade types onto a measurement so it yields more than one number —
     * `{ height: { value, unit } }` on a length (a wall's area), `{ pitch: {
     * rise } }` on an area (a roof's area from its plan), `{ depth: { value,
     * unit } }` on an area (a volume), `{ deducts: [[points]] }` on an area
     * (openings taken out of it). Kept as typed, in the unit typed, and
     * parsed by `parseFigures` on both sides; a figure it does not
     * recognise is ignored, never guessed at. Every derived number is worked
     * out when read, through the sheet's scale, exactly as the quantity is.
     */
    figures: jsonb("figures").notNull().default({}),
    /**
     * THE TAKEOFF'S FIRST LINK (ADR 0074), SUPERSEDED (ADR 0110). A trace now
     * stands behind lines through `job_estimate_line_traces` — one row per
     * (line, trace, figure), because one room traced once feeds the flooring
     * by its area and the baseboard by its perimeter. These two columns are
     * no longer written or read; the migration that made the table copied
     * every link into it, and a later migration drops them (a drop goes out
     * after its deploy).
     */
    estimateLineId: uuid("estimate_line_id"),
    pushedQuantityThousandths: bigint("pushed_quantity_thousandths", { mode: "number" }),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_sheet_markups_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_sheet_markups_tenant_sheet_idx").on(t.tenantId, t.sheetId),
    index("job_sheet_markups_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_sheet_markups_tenant_work_idx").on(t.tenantId, t.workItemId),
    index("job_sheet_markups_tenant_line_idx").on(t.tenantId, t.estimateLineId),
    foreignKey({
      name: "job_sheet_markups_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_sheet_markups_sheet_fk",
      columns: [t.tenantId, t.sheetId],
      foreignColumns: [jobSheets.tenantId, jobSheets.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("work_item_id")`:
    // a bare SET NULL would try to null tenant_id too and can never run on a composite key.
    foreignKey({
      name: "job_sheet_markups_work_fk",
      columns: [t.tenantId, t.workItemId],
      foreignColumns: [workItems.tenantId, workItems.id],
    }).onDelete("set null"),
    // The same column-list SET NULL: a line taken off the estimate leaves the measurement, unpushed.
    foreignKey({
      name: "job_sheet_markups_line_fk",
      columns: [t.tenantId, t.estimateLineId],
      foreignColumns: [jobEstimateLines.tenantId, jobEstimateLines.id],
    }).onDelete("set null"),
    check("job_sheet_markups_kind_valid", sql`${t.kind} in ('cloud', 'arrow', 'text', 'pin', 'length', 'area', 'count')`),
    check("job_sheet_markups_color_valid", sql`${t.color} in ('red', 'blue', 'green', 'yellow', 'black')`),
    check("job_sheet_markups_geometry_object", sql`jsonb_typeof(${t.geometry}) = 'object'`),
    check("job_sheet_markups_figures_object", sql`jsonb_typeof(${t.figures}) = 'object'`),
    check("job_sheet_markups_words_present", sql`${t.kind} not in ('text', 'pin') or length(btrim(${t.text})) > 0`),
    check("job_sheet_markups_text_bounded", sql`char_length(${t.text}) <= 2000`),
  ],
);

export type JobSheetMarkup = typeof jobSheetMarkups.$inferSelect;
export type NewJobSheetMarkup = typeof jobSheetMarkups.$inferInsert;

/**
 * WHAT STANDS BEHIND AN ESTIMATE LINE (ADR 0110): one row per trace and per
 * FIGURE of it. A room traced once yields its area, the run around it, and
 * — with a pitch or a depth typed on it — a roof or a volume; a wall's length
 * with a height typed on it yields the wall's area. Each of those figures can
 * stand behind a line of its own, so the flooring, the baseboard and the
 * ceiling read off ONE trace rather than three.
 *
 * `share_thousandths` is what THIS figure of THIS trace came to when it was
 * pushed, in thousandths of the line's unit — its own share, never the line's
 * total, so the page can say when the drawing has moved on from what it
 * pushed. Cascade from the line (a line taken off the estimate takes its
 * links) and from the trace (a trace rubbed out takes its links); the line
 * itself keeps its quantity either way, because the estimate is edited where
 * it lives (ADR 0074).
 */
export const jobEstimateLineTraces = pgTable(
  "job_estimate_line_traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    lineId: uuid("line_id").notNull(),
    markupId: uuid("markup_id").notNull(),
    /** Which of the trace's figures stands behind the line — `TRACE_FIGURES`: its own kind, or one it yields. */
    figure: text("figure").notNull(),
    /** What that figure came to when it was pushed, in thousandths of the line's unit. */
    shareThousandths: bigint("share_thousandths", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_line_traces_tenant_id_id_idx").on(t.tenantId, t.id),
    // One figure of one trace stands behind one line at most once; the same figure may stand behind another line.
    uniqueIndex("job_estimate_line_traces_once_idx").on(t.tenantId, t.lineId, t.markupId, t.figure),
    index("job_estimate_line_traces_tenant_markup_idx").on(t.tenantId, t.markupId),
    index("job_estimate_line_traces_tenant_line_idx").on(t.tenantId, t.lineId),
    foreignKey({
      name: "job_estimate_line_traces_line_fk",
      columns: [t.tenantId, t.lineId],
      foreignColumns: [jobEstimateLines.tenantId, jobEstimateLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_estimate_line_traces_markup_fk",
      columns: [t.tenantId, t.markupId],
      foreignColumns: [jobSheetMarkups.tenantId, jobSheetMarkups.id],
    }).onDelete("cascade"),
    check("job_estimate_line_traces_figure_valid", sql`${t.figure} in ('length', 'area', 'count', 'perimeter', 'wall', 'roof', 'volume')`),
    check("job_estimate_line_traces_share_nonneg", sql`${t.shareThousandths} >= 0`),
  ],
);

export type JobEstimateLineTrace = typeof jobEstimateLineTraces.$inferSelect;
export type NewJobEstimateLineTrace = typeof jobEstimateLineTraces.$inferInsert;
