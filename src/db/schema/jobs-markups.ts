import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobSheets } from "./jobs-drawings";
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
    /** cloud | arrow | text | pin — `MARKUP_KINDS`. */
    kind: text("kind").notNull(),
    /** red | blue | green | yellow | black — `MARKUP_COLORS`. */
    color: text("color").notNull().default("red"),
    /** Fractions of the page: a cloud {x,y,w,h}, an arrow {x1,y1,x2,y2}, a note or a pin {x,y}. Parsed by `parseGeometry`. */
    geometry: jsonb("geometry").notNull(),
    /** The note, or what the pin needs doing. Required for a note and a pin. */
    text: text("text").notNull().default(""),
    /** The punch item a pin raised, while it exists. */
    workItemId: uuid("work_item_id"),
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
    check("job_sheet_markups_kind_valid", sql`${t.kind} in ('cloud', 'arrow', 'text', 'pin')`),
    check("job_sheet_markups_color_valid", sql`${t.color} in ('red', 'blue', 'green', 'yellow', 'black')`),
    check("job_sheet_markups_geometry_object", sql`jsonb_typeof(${t.geometry}) = 'object'`),
    check("job_sheet_markups_words_present", sql`${t.kind} not in ('text', 'pin') or length(btrim(${t.text})) > 0`),
    check("job_sheet_markups_text_bounded", sql`char_length(${t.text}) <= 2000`),
  ],
);

export type JobSheetMarkup = typeof jobSheetMarkups.$inferSelect;
export type NewJobSheetMarkup = typeof jobSheetMarkups.$inferInsert;
