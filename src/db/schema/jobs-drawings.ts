import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { jobProjects } from "./jobs";
import { parties } from "./parties";
import { tenants } from "./platform";

/**
 * A job's drawings (ADR 0072): sets and sheets.
 *
 * THE FILE IS DOCUMENTS'. A set's PDFs are ordinary documents in the cabinet,
 * hung on the set through `document_attachments` the way a lien waiver's
 * signed copy hangs on the waiver; the pack keeps what the cabinet does not
 * know — which page is which sheet, and which issue it came in.
 *
 * A SET IS AN ISSUE, not a folder: the permit set, the construction set, ASI 3
 * with two sheets, addendum 2. A full re-issue and a three-sheet bulletin are
 * the same row with different page counts, which is what lets the current
 * set be DERIVED — the newest issue of each sheet number, by `issued_on` and
 * then by creation — rather than kept as a flag somebody forgets to move.
 */
export const jobDrawingSets = pgTable(
  "job_drawing_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** "Permit set", "Construction set", "ASI 3", "Addendum 2". */
    name: text("name").notNull(),
    /** The date on the drawings, which orders the issues. */
    issuedOn: date("issued_on").notNull(),
    /** Who issued it — the architect, the engineer — when the business keeps them as a party. */
    fromPartyId: uuid("from_party_id"),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_drawing_sets_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_drawing_sets_tenant_project_idx").on(t.tenantId, t.projectId),
    foreignKey({
      name: "job_drawing_sets_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_drawing_sets_party_fk",
      columns: [t.tenantId, t.fromPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_drawing_sets_name_present", sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * One sheet: a page of one of the set's files, with the number the trade
 * calls it by. The number is normalised on write (trimmed, upper-cased, one
 * space at most) so `a-101` and `A-101` are one sheet; the discipline the
 * page groups by is read from its first letter and never stored.
 */
export const jobSheets = pgTable(
  "job_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    setId: uuid("set_id").notNull(),
    documentId: uuid("document_id").notNull(),
    /** 1-based page of the file. */
    pageNumber: integer("page_number").notNull(),
    /** "A-101", "S2.1", "E-001" — free text, normalised, never a list the pack ships. */
    sheetNumber: text("sheet_number").notNull(),
    /** "FIRST FLOOR PLAN" as the title block has it, or what the office typed. */
    title: text("title").notNull().default(""),
    /** The title block's own revision mark, when there is one: "2", "B", "ASI-3". */
    revision: text("revision").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_sheets_tenant_id_id_idx").on(t.tenantId, t.id),
    // One number per issue: a set that carried A-101 twice would make "the current A-101" a coin toss.
    uniqueIndex("job_sheets_set_number_idx").on(t.tenantId, t.setId, t.sheetNumber),
    // One page indexed once per issue.
    uniqueIndex("job_sheets_set_page_idx").on(t.tenantId, t.setId, t.documentId, t.pageNumber),
    index("job_sheets_tenant_project_number_idx").on(t.tenantId, t.projectId, t.sheetNumber),
    index("job_sheets_tenant_document_idx").on(t.tenantId, t.documentId),
    foreignKey({
      name: "job_sheets_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_sheets_set_fk",
      columns: [t.tenantId, t.setId],
      foreignColumns: [jobDrawingSets.tenantId, jobDrawingSets.id],
    }).onDelete("cascade"),
    // A file taken out of the cabinet takes its pages with it; a sheet with no file is nothing to open.
    foreignKey({
      name: "job_sheets_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete("cascade"),
    check("job_sheets_number_present", sql`length(btrim(${t.sheetNumber})) > 0`),
    check("job_sheets_page_positive", sql`${t.pageNumber} >= 1`),
  ],
);

export type JobDrawingSet = typeof jobDrawingSets.$inferSelect;
export type NewJobDrawingSet = typeof jobDrawingSets.$inferInsert;
export type JobSheet = typeof jobSheets.$inferSelect;
export type NewJobSheet = typeof jobSheets.$inferInsert;
