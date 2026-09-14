/**
 * The budget — what a job was meant to cost, one cost code at a time.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The fourth and last of the numbers a
 * builder looks at, and the one that makes the other three mean something:
 *
 *   WORTH      the contracts, signed        (`job_contracts`)
 *   PLANNED    the budget                   ← this file
 *   ORDERED    the commitments, issued      (`job_commitments`)
 *   SPENT      the ledger, by project       (`getBalances`)
 *
 * Committed and actual on their own say what has happened. Only a planned figure
 * turns them into a question worth asking — *is the framing going to come in?* —
 * and that question is asked per cost code, never per job, because "the job is
 * $40k over" is a fact and "the framing is $40k over" is a decision.
 *
 * ── ONE LINE PER CODE PER PROJECT, AND THAT IS THE WHOLE MODEL ──────────────
 *
 * No header, no revisions table, no versions of a budget. A unique index on
 * `(tenant_id, project_id, cost_code_id)` makes the budget a SET of codes with
 * amounts, which is exactly how a builder writes one down.
 *
 * **`original_cents` IS NAMED FOR WHAT COMES NEXT.** A construction budget moves
 * for exactly one legitimate reason — an approved change order — and the
 * reporting line every owner and surety knows is *original + approved changes =
 * revised*. Calling this `amount_cents` would have made the first change order a
 * migration and a conversation about which number the old column held. The
 * revision side is slice 4's, and it will add its own column or its own rows
 * beside this one; what it will not have to do is rename this.
 *
 * ── WHY THERE IS NO `revised_cents` YET ─────────────────────────────────────
 *
 * Because nothing would write it. A column nothing reads is worse than an honest
 * absence — the standard this pack set by refusing `PackDefinition
 * .dimensionTypes` and then by deleting `projectValues.openCount` before it
 * shipped. Until change orders exist, revised IS original, and the screen says
 * so rather than showing two identical columns.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { jobProjects, jobCostCodes } from "./jobs";

export const jobBudgetLines = pgTable(
  "job_budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /**
     * NOT NULL, unlike a commitment line's. A commitment without a code is still
     * money owed and has to be recordable; **a budget line without a code is not
     * a budget**, it is a single number for the whole job, which is the thing
     * this table exists to stop being the answer.
     */
    costCodeId: uuid("cost_code_id").notNull(),
    /** What this code was planned to cost, in cents. See the file header. */
    originalCents: bigint("original_cents", { mode: "number" }).notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_budget_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * ONE LINE PER CODE PER PROJECT. Two would make every variance ambiguous and
     * every total quietly wrong, so the database refuses rather than the action
     * remembering to.
     */
    uniqueIndex("job_budget_lines_project_code_idx").on(
      t.tenantId,
      t.projectId,
      t.costCodeId,
    ),
    index("job_budget_lines_tenant_project_idx").on(t.tenantId, t.projectId),
    /** A project's budget is part of the project. */
    foreignKey({
      name: "job_budget_lines_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /**
     * RESTRICT, like a commitment line's. A code with a budget against it is
     * RETIRED, never deleted — `updateCostCode` has no delete verb, and this key
     * is the backstop that proves it.
     */
    foreignKey({
      name: "job_budget_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    /**
     * Non-negative. A budget of zero is meaningful — a code carried at nil, so
     * anything spent against it shows as a variance — but a NEGATIVE plan is not
     * a thing a builder writes down.
     */
    check("job_budget_lines_original_nonnegative", sql`${t.originalCents} >= 0`),
  ],
);

export type JobBudgetLine = typeof jobBudgetLines.$inferSelect;
