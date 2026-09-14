/**
 * The field — what happened on the site today.
 *
 * Part of the `jobs` pack (Layer 2a, P4), and the first slice of it somebody
 * standing on a site touches. Two tables, and everything else the design
 * calls "field" is a seam this pack already had:
 *
 *   - a DAILY LOG is a row here: one per project per day, with the weather,
 *     what happened, and who was on site;
 *   - the CREWS on it are lines here: a trade or a subcontractor, how many,
 *     how long;
 *   - PHOTOS are Documents' rows, hung on the day through
 *     `document_attachments` (`entity_type = 'job_daily_log'`), the way a
 *     photo of an animal or an asset already is;
 *   - the PUNCH LIST is Work's rows, linked to the project through
 *     `work_item_links` (`entity_type = 'project'`) — never a second task
 *     engine (extension-model.md §4b).
 *
 * ── ONE LOG PER PROJECT PER DAY ─────────────────────────────────────────────
 *
 * A superintendent keeps ONE daily report per job, and "poured the slab" said
 * at nine and "framers started" said at two are two lines of the same day, not
 * two days. So the unique index is on `(project, date)` and the pack's verb
 * UPSERTS: a sentence told from the field appends to the day that exists.
 *
 * ── MANPOWER IS A HEADCOUNT, NOT PAYROLL ────────────────────────────────────
 *
 * "Four guys, six hours" on a daily log is who was on the site — the
 * company's own crew, the framer's crew, the electrician's — and it is what an
 * owner's representative reads and a delay claim is argued from. It is NOT a
 * time entry: the `time` module records the company's own people to the
 * minute for wages, and a subcontractor's crew never appears there. The two
 * answer different questions and stay apart.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { parties } from "./parties";
import { jobProjects } from "./jobs";

export const jobDailyLogs = pgTable(
  "job_daily_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    logDate: date("log_date", { mode: "string" }).notNull(),
    /** Free text: "Clear, 78°F", "Rain until noon". Nobody codes weather. */
    weather: text("weather").notNull().default(""),
    /** What happened, in the order it was said. A sentence from the field appends a line. */
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_daily_logs_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One report per job per day — see the header. */
    uniqueIndex("job_daily_logs_project_date_idx").on(t.tenantId, t.projectId, t.logDate),
    index("job_daily_logs_tenant_project_idx").on(t.tenantId, t.projectId),
    foreignKey({
      name: "job_daily_logs_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Who was on site: one line per trade or subcontractor on a day.
 *
 * A line names a TRADE ("Framing"), a PARTY (the framing subcontractor on
 * file), or both; a line naming neither is a number with no meaning, and the
 * CHECK refuses it. Hours are per worker, in tenths, because "six and a half
 * hours" is what gets said and a tenth is the unit a daily report is kept in.
 */
export const jobDailyLogCrews = pgTable(
  "job_daily_log_crews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    logId: uuid("log_id").notNull(),
    /** The subcontractor, when it is one on file. */
    partyId: uuid("party_id"),
    /** "Framing", "Electrical", "Own crew". Free text; a profile may suggest. */
    trade: text("trade").notNull().default(""),
    workers: integer("workers").notNull().default(0),
    /** Hours EACH, in tenths: 6.5 hours is 65. */
    hoursTenths: integer("hours_tenths").notNull().default(0),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_daily_log_crews_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_daily_log_crews_tenant_log_idx").on(t.tenantId, t.logId, t.sortOrder),
    foreignKey({
      name: "job_daily_log_crews_log_fk",
      columns: [t.tenantId, t.logId],
      foreignColumns: [jobDailyLogs.tenantId, jobDailyLogs.id],
    }).onDelete("cascade"),
    /** RESTRICT: a subcontractor who was on a site is not deleted out of the record. */
    foreignKey({
      name: "job_daily_log_crews_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_daily_log_crews_workers_nonnegative", sql`${t.workers} >= 0`),
    check("job_daily_log_crews_hours_nonnegative", sql`${t.hoursTenths} >= 0`),
    check(
      "job_daily_log_crews_named",
      sql`length(btrim(${t.trade})) > 0 or ${t.partyId} is not null`,
    ),
  ],
);

export type JobDailyLog = typeof jobDailyLogs.$inferSelect;
export type JobDailyLogCrew = typeof jobDailyLogCrews.$inferSelect;
