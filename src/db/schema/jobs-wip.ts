/**
 * Work in progress — percent complete, earned revenue, and the over- and
 * under-billing that a bank and a surety read first.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The sixth slice, and the one that
 * makes a contractor's books say what the work is WORTH rather than what has
 * been billed for it. Billing runs ahead of the work on some jobs and behind
 * it on others; a builder whose revenue is "what we invoiced" reports a
 * profit that swings with the draw schedule rather than the work. The WIP
 * schedule fixes that at a period end:
 *
 *   percent complete   = cost to date ÷ estimated total cost   (cost-to-cost)
 *   earned revenue     = contract value × percent complete
 *   under-billed       = earned − billed, when positive   → 1240, an asset
 *   over-billed        = billed − earned, when positive   → 2420, a liability
 *
 * and the adjustment is an ordinary journal entry the pack posts itself,
 * because a basis lens may not invent an entry (docs/modules/construction.md,
 * the basis-lens finding) — and a self-reversing one, dated the period end and
 * reversed the next day, so every period's entry is the whole figure and the
 * books in between carry billings (ADR 0059).
 *
 * ── A PERIOD IS PER COMPANY, LIKE A CLOSE ───────────────────────────────────
 *
 * `entity_id` is on the period because the entry lands in one set of books and
 * the close that locks it is per company (ADR 0010 slice 4). A tenant with
 * three LLCs runs three schedules; a tenant with one never sees the choice.
 * Unique on `(entity, period_end)`: one schedule per company per date.
 *
 * ── A LINE HOLDS ONE HUMAN INPUT AND SIX FROZEN FIGURES ─────────────────────
 *
 * The one thing a person types is `estimate_cents` — the RE-ESTIMATED total
 * cost of the job as of this period, the input every monthly WIP meeting
 * exists to produce. NULL means "the revised budget", which is the answer for
 * a business that does not re-estimate. Everything else is computed, and
 * WRITTEN DOWN when the period posts: the figures a bank was shown must read
 * the same next year whatever the ledger has become, the same rule a pay
 * application's totals follow. Zero while a draft, like an application's.
 *
 * Over/under is not stored: it is `earned − billed`, one subtraction, and a
 * stored copy would be one more number able to disagree with the two it is
 * made from.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { entities, journalEntries } from "./ledger";
import { jobProjects } from "./jobs";

export const jobWipPeriods = pgTable(
  "job_wip_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** WHOSE BOOKS the adjustment lands in. One schedule per company per date. */
    entityId: uuid("entity_id").notNull(),
    /** The day the schedule is as of — a month end, for nearly everybody. */
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    /** `draft` while the figures are live; `posted` once the entry exists. */
    status: text("status").notNull().default("draft"),
    /** The adjustment, dated `period_end`. RESTRICT: voided, never deleted. */
    entryId: uuid("entry_id"),
    /** Its reversal, dated the day after. Both carry the `wip_adjustment` source. */
    reversalEntryId: uuid("reversal_entry_id"),
    notes: text("notes").notNull().default(""),
    postedOn: date("posted_on", { mode: "string" }),
    postedByClerkUserId: text("posted_by_clerk_user_id"),
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
    uniqueIndex("job_wip_periods_tenant_id_id_idx").on(t.tenantId, t.id),
    /** ONE SCHEDULE PER COMPANY PER DATE. */
    uniqueIndex("job_wip_periods_entity_period_idx").on(
      t.tenantId,
      t.entityId,
      t.periodEnd,
    ),
    index("job_wip_periods_tenant_entity_idx").on(t.tenantId, t.entityId, t.status),
    /**
     * RESTRICT to the company: a company with a posted WIP period is not
     * something that gets deleted, and the composite key makes another
     * tenant's company unrepresentable.
     */
    foreignKey({
      name: "job_wip_periods_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    /** RESTRICT to the entries: an entry is voided, never deleted. */
    foreignKey({
      name: "job_wip_periods_entry_fk",
      columns: [t.tenantId, t.entryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    foreignKey({
      name: "job_wip_periods_reversal_fk",
      columns: [t.tenantId, t.reversalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    check("job_wip_periods_status_valid", sql`${t.status} in ('draft', 'posted')`),
    /** "Posted but no entry" and "an entry but still a draft" are both unrepresentable. */
    check(
      "job_wip_periods_posted_has_entry",
      sql`(${t.status} = 'posted') = (${t.entryId} is not null)`,
    ),
    /** A reversal without an adjustment to reverse is nonsense. */
    check(
      "job_wip_periods_reversal_needs_entry",
      sql`${t.reversalEntryId} is null or ${t.entryId} is not null`,
    ),
  ],
);

export const jobWipLines = pgTable(
  "job_wip_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodId: uuid("period_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /**
     * THE ONE HUMAN INPUT: the re-estimated total cost of the job as of this
     * period. NULL means the revised budget stands, which is what a business
     * that does not re-estimate every month gets without typing anything.
     */
    estimateCents: bigint("estimate_cents", { mode: "number" }),
    notes: text("notes").notNull().default(""),
    /**
     * Why this job was left out of the entry, when it was: `no_value` (no fixed
     * contract value to earn against) or `no_estimate` (nothing to measure
     * cost against). Empty when the job posted. Frozen with the rest.
     */
    reason: text("reason").notNull().default(""),
    /**
     * HOW EARNED WAS MEASURED (slice 5b). `cost_to_cost`: the contract value at
     * the percent complete. `cost_plus`: cost to date plus the fee on it,
     * capped at the GMAX — a job on a single cost-plus contract earns what it
     * has spent plus its fee, and needs no estimate to say so. Frozen with the
     * rest, because the schedule a bank was shown must say which.
     */
    method: text("method").notNull().default("cost_to_cost"),
    // Frozen at posting, zero while a draft — see the file header.
    contractCents: bigint("contract_cents", { mode: "number" }).notNull().default(0),
    estimatedCostCents: bigint("estimated_cost_cents", { mode: "number" }).notNull().default(0),
    costToDateCents: bigint("cost_to_date_cents", { mode: "number" }).notNull().default(0),
    billedCents: bigint("billed_cents", { mode: "number" }).notNull().default(0),
    /** Parts per million, so 100% is a million — the pack's convention since retainage. */
    percentCompletePpm: integer("percent_complete_ppm").notNull().default(0),
    earnedCents: bigint("earned_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_wip_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One line per job per period. */
    uniqueIndex("job_wip_lines_period_project_idx").on(t.tenantId, t.periodId, t.projectId),
    index("job_wip_lines_tenant_project_idx").on(t.tenantId, t.projectId),
    /** A period's lines are part of the period. */
    foreignKey({
      name: "job_wip_lines_period_fk",
      columns: [t.tenantId, t.periodId],
      foreignColumns: [jobWipPeriods.tenantId, jobWipPeriods.id],
    }).onDelete("cascade"),
    /**
     * CASCADE from the project, like a contract's and a budget line's: a
     * project that can be deleted takes its schedule lines with it. The
     * entry, if one posted, stays — it is the ledger's, and voided is the only
     * way it goes.
     */
    foreignKey({
      name: "job_wip_lines_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    check(
      "job_wip_lines_estimate_nonnegative",
      sql`${t.estimateCents} is null or ${t.estimateCents} >= 0`,
    ),
    check(
      "job_wip_lines_percent_range",
      sql`${t.percentCompletePpm} between 0 and 1000000`,
    ),
    check(
      "job_wip_lines_reason_valid",
      sql`${t.reason} in ('', 'no_value', 'no_estimate', 'no_rate')`,
    ),
    check(
      "job_wip_lines_method_valid",
      sql`${t.method} in ('cost_to_cost', 'cost_plus', 'time_and_materials')`,
    ),
  ],
);

export type JobWipPeriod = typeof jobWipPeriods.$inferSelect;
export type JobWipLine = typeof jobWipLines.$inferSelect;
