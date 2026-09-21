/**
 * Selections and allowances — what the client still has to choose, what the
 * contract set aside for it, and what the choice actually costs.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 8 of the construction plan.
 *
 * ── ONE MECHANISM FOR TWO TRADES (ADR 0067) ─────────────────────────────────
 *
 * A custom builder writes ALLOWANCES into the contract — "$12,000 for
 * flooring", chosen later by the client — and reconciles each against what
 * was picked: the overage is billed, the underage credited. A production
 * builder offers an OPTION BOOK — standard laminate included, quartz +$3,200,
 * granite +$4,100 — and the buyer's picks add to the base price. Both are the
 * same two rows: a SELECTION (a decision the client owes, with the money the
 * contract already holds for it and the date it is needed by) and its
 * CHOICES (what is on offer, each with a price, one of them chosen). A
 * production option is a selection whose allowance is the standard's price
 * and whose choices are the upgrades; a custom allowance is a selection whose
 * choices are whatever the client is weighing.
 *
 * ── THE DIFFERENCE IS COMPUTED, AND IT MOVES BY CHANGE ORDER ────────────────
 *
 * Chosen price less allowance is the overage (or underage), computed wherever
 * it is shown and never stored. Once the builder has approved the choice, the
 * difference is raised as a CHANGE ORDER on the selection's contract — slice
 * 4's row, the one legitimate way a signed value moves — and the selection
 * remembers which one, so it cannot be raised twice. A business that
 * reconciles allowances at the end rather than as it goes simply raises them
 * later; nothing here bills on its own.
 *
 * ── A SELECTION BELONGS TO THE JOB; ITS MONEY TO A CONTRACT ─────────────────
 *
 * The room is the job's; the allowance is a contract's, because that is the
 * price it is inside. `contract_id` is nullable: a selection list can be
 * drawn up during design, before the build contract exists, and tied to the
 * agreement when it is signed. A selection with no contract has nowhere to
 * raise its difference and the verb says so.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { jobProjects, jobCostCodes } from "./jobs";
import { jobContracts } from "./jobs-contracts";
import { jobChangeOrders } from "./jobs-change-orders";
import { jobEstimateGroups } from "./jobs-estimates";

export const jobSelections = pgTable(
  "job_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The agreement whose price holds the allowance; null while the list is drawn up before one exists. */
    contractId: uuid("contract_id"),
    /** The change order raised for the difference, once it has been. Null until then. */
    changeOrderId: uuid("change_order_id"),
    /**
     * **THE ITEM ON THE ACCEPTED ESTIMATE THAT MADE THIS** (X12), or null for
     * every selection somebody wrote by hand — which is all of them before
     * this existed and most of them after.
     *
     * Accepting an estimate turns each item marked as an allowance into one
     * of these rows, and the link is what stops it happening twice: matching
     * on the NAME would miss an allowance somebody renamed and would collide
     * with a second job's *Plumbing fixtures*. The same call the walk makes
     * for its own lines, and for the same reason — by id where there is one.
     */
    estimateGroupId: uuid("estimate_group_id"),
    /** Where the money lands in the budget, and the line a raised change order carries. */
    costCodeId: uuid("cost_code_id"),
    /** "Master bath tile", "Kitchen countertops", "Front door hardware". */
    name: text("name").notNull(),
    /** The room or area, as the business says it: "Master bath", "Lot 14 kitchen". */
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    /**
     * What the contract set aside, in cents. 0 for a standard included item or
     * a selection with no allowance.
     *
     * **IT IS A PRICE, NOT A COST**, when an accepted estimate wrote it: the
     * founder's rule is *"the allowance is a cost we mark up like everything
     * else"*, so the figure the client is held to is the marked-up one — and
     * the difference a change order raises is then price against price, which
     * is the only comparison that means anything on a signed contract.
     */
    allowanceCents: bigint("allowance_cents", { mode: "number" }).notNull().default(0),
    /** When the choice is needed, for the schedule to hold. */
    neededBy: date("needed_by", { mode: "string" }),
    /** text + CHECK: pending (the client owes it), selected (the client chose), approved (the builder confirmed), cancelled. */
    status: text("status").notNull().default("pending"),
    /** When the client chose. */
    decidedOn: date("decided_on", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
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
    uniqueIndex("job_selections_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_selections_tenant_project_idx").on(t.tenantId, t.projectId, t.sortOrder),
    index("job_selections_tenant_contract_idx").on(t.tenantId, t.contractId),
    index("job_selections_tenant_status_idx").on(t.tenantId, t.status),
    index("job_selections_tenant_needed_idx").on(t.tenantId, t.neededBy),
    /** A job's selections are part of it. */
    foreignKey({
      name: "job_selections_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** NO ACTION: the contract an allowance sits in stays; the job's cascade takes both together. */
    foreignKey({
      name: "job_selections_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }),
    /** NO ACTION: the change order raised for the difference cannot go from under the selection that raised it. */
    foreignKey({
      name: "job_selections_change_order_fk",
      columns: [t.tenantId, t.changeOrderId],
      foreignColumns: [jobChangeOrders.tenantId, jobChangeOrders.id],
    }),
    /** RESTRICT: a code with selections against it is retired, never deleted. */
    foreignKey({
      name: "job_selections_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    // Hand-edited in the migration to the column-list form
    // `ON DELETE SET NULL ("estimate_group_id")` — a bare SET NULL on a
    // composite (tenant_id, x) key would try to null tenant_id as well and
    // can never run. An item deleted off an estimate leaves the selection it
    // created standing: the client agreed to that allowance, and the estimate
    // is only where it came from.
    foreignKey({
      name: "job_selections_estimate_group_fk",
      columns: [t.tenantId, t.estimateGroupId],
      foreignColumns: [jobEstimateGroups.tenantId, jobEstimateGroups.id],
    }).onDelete("set null"),
    check("job_selections_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "job_selections_status_valid",
      sql`${t.status} in ('pending', 'selected', 'approved', 'cancelled')`,
    ),
    check("job_selections_allowance_nonnegative", sql`${t.allowanceCents} >= 0`),
  ],
);

/**
 * What is on offer for a selection — and, once the client has chosen, which
 * one. A production builder's option book is these rows; a custom builder's
 * are whatever samples came back from the showroom.
 *
 * A choice may be priced by the unit (320 sf at $4.20) or as a sum; the
 * unit-price columns are both or neither, as a schedule line's are (ADR
 * 0064), and `price_cents` is the extended figure either way, computed on
 * save when the unit pair is present. **At most one chosen per selection**,
 * by a partial unique index: two chosen choices would be two prices for one
 * decision.
 */
export const jobSelectionChoices = pgTable(
  "job_selection_choices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    selectionId: uuid("selection_id").notNull(),
    /** The supplier or showroom, when it is somebody in the books. */
    partyId: uuid("party_id"),
    /** "Daltile Rittenhouse 3x6, white". */
    description: text("description").notNull(),
    /** Model, SKU or catalogue number. */
    reference: text("reference").notNull().default(""),
    unit: text("unit").notNull().default(""),
    quantityThousandths: bigint("quantity_thousandths", { mode: "number" }),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
    /** The extended price, in cents: quantity at the unit price when priced by the unit, else as typed. */
    priceCents: bigint("price_cents", { mode: "number" }).notNull().default(0),
    /** The client's pick. At most one per selection. */
    isSelected: boolean("is_selected").notNull().default(false),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_selection_choices_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_selection_choices_tenant_selection_idx").on(t.tenantId, t.selectionId, t.sortOrder),
    /** ONE CHOSEN PER SELECTION, at the database: a partial unique index, the cost code set's default rule. */
    uniqueIndex("job_selection_choices_one_chosen_idx")
      .on(t.tenantId, t.selectionId)
      .where(sql`${t.isSelected}`),
    /** A selection's choices are part of it. */
    foreignKey({
      name: "job_selection_choices_selection_fk",
      columns: [t.tenantId, t.selectionId],
      foreignColumns: [jobSelections.tenantId, jobSelections.id],
    }).onDelete("cascade"),
    /** No cascade: a supplier named on a choice cannot be merged away underneath it. */
    foreignKey({
      name: "job_selection_choices_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_selection_choices_description_present", sql`length(btrim(${t.description})) > 0`),
    check("job_selection_choices_price_nonnegative", sql`${t.priceCents} >= 0`),
    check(
      "job_selection_choices_quantity_nonnegative",
      sql`${t.quantityThousandths} is null or ${t.quantityThousandths} >= 0`,
    ),
    check(
      "job_selection_choices_unit_price_nonnegative",
      sql`${t.unitPriceCents} is null or ${t.unitPriceCents} >= 0`,
    ),
    /** Priced by the unit or not at all: a quantity with no price, or a price with no quantity, is half a figure. */
    check(
      "job_selection_choices_unit_pair",
      sql`(${t.quantityThousandths} is null) = (${t.unitPriceCents} is null)`,
    ),
  ],
);

export type JobSelection = typeof jobSelections.$inferSelect;
export type JobSelectionChoice = typeof jobSelectionChoices.$inferSelect;
