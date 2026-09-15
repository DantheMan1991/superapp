/**
 * A job's schedule — its phases and milestones, each an all-day item on the
 * business's *Job schedule* calendar with a row of the pack's beside it.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The construction plan never listed
 * it and every builder lives by it; ADR 0071 settles the shape.
 *
 * ── CORE OWNS THE DATES ─────────────────────────────────────────────────────
 *
 * A phase's first and last day live on `schedule_items` (`starts_at` at the
 * start of the first day in the tenant's zone, `ends_at` at the start of the
 * day after the last, `all_day`), which is what puts every job's phases on
 * the company calendar, the week view and the phone feed with no work of
 * their own. This table holds what a calendar does not know: the order, the
 * predecessor and its lag, the trade doing it, the cost code, and whether
 * it is planned, underway or done. The item's title is written by the pack
 * as "24-109 · Framing" and re-written when the phase is renamed.
 *
 * ── FINISH-TO-START WITH A LAG ──────────────────────────────────────────────
 *
 * `predecessor_id` is a self-reference: this phase may not start before the
 * day after its predecessor's last day plus `lag_days` (negative for an
 * overlap). The verb refuses a loop and pushes successors when a phase moves
 * later; the database holds the key and the format.
 */
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobCostCodes, jobProjects } from "./jobs";
import { parties } from "./parties";
import { tenants } from "./platform";
import { scheduleItems } from "./scheduling";

export const jobPhases = pgTable(
  "job_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The calendar item that holds the dates; one per phase. */
    itemId: uuid("item_id").notNull(),
    name: text("name").notNull(),
    /** phase | milestone — a milestone is one day and draws as a point. */
    kind: text("kind").notNull().default("phase"),
    /** planned | underway | done. */
    status: text("status").notNull().default("planned"),
    predecessorId: uuid("predecessor_id"),
    lagDays: integer("lag_days").notNull().default(0),
    /** The trade or crew doing it. */
    partyId: uuid("party_id"),
    costCodeId: uuid("cost_code_id"),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_phases_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_phases_item_idx").on(t.tenantId, t.itemId),
    index("job_phases_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_phases_tenant_predecessor_idx").on(t.tenantId, t.predecessorId),
    foreignKey({
      name: "job_phases_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** The item is the dates: a phase without one is nothing, so it goes with its item. */
    foreignKey({
      name: "job_phases_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [scheduleItems.tenantId, scheduleItems.id],
    }).onDelete("cascade"),
    /** NO ACTION: the verb re-points successors before a phase is removed. */
    foreignKey({
      name: "job_phases_predecessor_fk",
      columns: [t.tenantId, t.predecessorId],
      foreignColumns: [t.tenantId, t.id],
    }),
    /** NO ACTION: who does the work is held, the way every party reference is. */
    foreignKey({
      name: "job_phases_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    foreignKey({
      name: "job_phases_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    check("job_phases_name_present", sql`length(btrim(${t.name})) > 0`),
    check("job_phases_kind_valid", sql`${t.kind} in ('phase', 'milestone')`),
    check("job_phases_status_valid", sql`${t.status} in ('planned', 'underway', 'done')`),
    check("job_phases_no_self_predecessor", sql`${t.predecessorId} is distinct from ${t.id}`),
    check("job_phases_lag_within_a_year", sql`${t.lagDays} between -365 and 365`),
  ],
);

export type JobPhase = typeof jobPhases.$inferSelect;
export type NewJobPhase = typeof jobPhases.$inferInsert;
