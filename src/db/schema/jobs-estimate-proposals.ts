/**
 * What a walk proposes for a step, before anybody accepts it (X2b, ADR 0098).
 *
 * ── WHY THIS IS A TABLE AND NOT A VALUE HELD IN THE PAGE ────────────────────
 *
 * Everything else about a walk survives a reload — the pending question, the
 * answers, the bookmark — because a walk is forty-five minutes long and
 * somebody will close the laptop. A proposal held only in the browser would
 * be the one thing that did not, and losing it costs a model call and the
 * estimator's place.
 *
 * ── A PROPOSAL IS NOT AN ESTIMATE LINE ──────────────────────────────────────
 *
 * It becomes one when the estimator presses the button, and the row then
 * remembers which line it became (`estimate_line_id`) — the shape a takeoff
 * already uses for a measurement it pushed (ADR 0074). Until then nothing is
 * on the estimate, which is what makes the review real: a walk that wrote as
 * it went would be a walk nobody read.
 *
 * ── THE BASIS IS THE POINT OF THE WHOLE SLICE ───────────────────────────────
 *
 * `basis` says where the MONEY came from and `quantity_basis` where the
 * QUANTITY did, because they are different questions with different answers —
 * a line can be priced from last year's job and measured from a sentence
 * this morning. The pack's own assembly tests say why it matters: **a
 * plausible wrong number in an estimate is worse than a refusal, because it
 * goes out in a proposal.**
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { jobEstimateInterviews } from "./jobs-estimate-interviews";

/** Where the money on a line came from. Blank on a line nobody walked. */
export const LINE_BASES = ["assembly", "memory", "said", "sub", "none"] as const;
/** Where the quantity came from. */
export const QUANTITY_BASES = ["said", "derived", "none"] as const;

export const jobEstimateProposedLines = pgTable(
  "job_estimate_proposed_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").notNull(),
    /** The outline step this came out of. A reference, as the answers are. */
    stepId: uuid("step_id"),
    /** Its name AS IT WAS, so a renamed step cannot rewrite the record. */
    stepTitle: text("step_title").notNull().default(""),
    /**
     * And the heading it sat under, for the same reason: the item this line
     * lands in is printed under it, and re-sectioning the outline next month
     * must not silently re-section a bid that already went out.
     */
    stepSection: text("step_section").notNull().default(""),

    description: text("description").notNull(),
    clientDescription: text("client_description").notNull().default(""),
    clientVisible: boolean("client_visible").notNull().default(true),
    unit: text("unit").notNull().default(""),
    quantityThousandths: bigint("quantity_thousandths", { mode: "number" })
      .notNull()
      .default(1000),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull().default(0),
    /** By its digits, resolved against the job's own list when applied. */
    costCode: text("cost_code").notNull().default(""),

    /** Where the MONEY came from. */
    basis: text("basis").notNull().default("none"),
    /** "your last price on 24-108", "you said so". */
    basisDetail: text("basis_detail").notNull().default(""),
    /** Where the QUANTITY came from — a different question from the price. */
    quantityBasis: text("quantity_basis").notNull().default("none"),
    /** The arithmetic, when it was derived: "2 baths at 3 fixtures each". */
    quantityNote: text("quantity_note").notNull().default(""),

    /**
     * WHEN SOMEBODY WAS ASKED FOR THIS PRICE AND SAID NOT NOW (X6). Without
     * it the walk asks the same unpriced line forever; with it a pass is a
     * decision that sticks, and the line shows up unpriced in the reckoning
     * where it belongs.
     */
    pricePassedAt: timestamp("price_passed_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** The line it became, once the estimator put it on the estimate. */
    estimateLineId: uuid("estimate_line_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_proposed_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_proposed_lines_tenant_interview_idx").on(
      t.tenantId,
      t.interviewId,
      t.sortOrder,
    ),
    /** A proposal is part of the walk that made it. */
    foreignKey({
      name: "job_estimate_proposed_lines_interview_fk",
      columns: [t.tenantId, t.interviewId],
      foreignColumns: [jobEstimateInterviews.tenantId, jobEstimateInterviews.id],
    }).onDelete("cascade"),
    check(
      "job_estimate_proposed_lines_description_present",
      sql`length(btrim(${t.description})) > 0`,
    ),
    check(
      "job_estimate_proposed_lines_basis_valid",
      sql`${t.basis} in ('assembly', 'memory', 'said', 'sub', 'none')`,
    ),
    check(
      "job_estimate_proposed_lines_quantity_basis_valid",
      sql`${t.quantityBasis} in ('said', 'derived', 'none')`,
    ),
    /** Money and quantities are never negative on an estimate. */
    check(
      "job_estimate_proposed_lines_amounts_sane",
      sql`${t.quantityThousandths} >= 0 and ${t.unitCostCents} >= 0`,
    ),
    /**
     * **A DERIVED QUANTITY SHOWS ITS WORKING, OR IT IS NOT DERIVED.** The
     * founder asked for arithmetic on the condition that it is visible; a row
     * claiming `derived` with nothing to show would be the unexplained number
     * this slice exists to refuse.
     */
    check(
      "job_estimate_proposed_lines_derived_shows_working",
      sql`(${t.quantityBasis} = 'derived') = (length(btrim(${t.quantityNote})) > 0)`,
    ),
    /** Applied means both, or neither. Half a record is not one. */
    check(
      "job_estimate_proposed_lines_applied_whole",
      sql`(${t.estimateLineId} is null) = (${t.appliedAt} is null)`,
    ),
  ],
);

export type JobEstimateProposedLine = typeof jobEstimateProposedLines.$inferSelect;
