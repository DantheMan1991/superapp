/**
 * Estimates — what a job is expected to cost and what it will be priced at,
 * line by line, before anybody signs.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 10 of the construction plan
 * (`estimating`), the front end of every job: the number the contract value
 * comes from, the budget comes from, and the schedule of values comes from.
 *
 * ── COST AND PRICE ARE TWO NUMBERS ON EVERY LINE (ADR 0069) ────────────────
 *
 * A line is a quantity of a unit at a UNIT COST — 320 sf of tile at $4.20,
 * one lump of $12,000 for the plumbing subcontract — and what it is SOLD for:
 * either a markup on the cost (this line's, or the estimate's default) or an
 * explicit unit price, which is how a unit-price bid is written. The extended
 * cost and price are computed from these, never typed; the change order made
 * the same choice for the same reason.
 *
 * ── OVERHEAD AND PROFIT SIT BELOW THE LINES ─────────────────────────────────
 *
 * Some businesses mark up every line and stop; some price the lines at cost
 * and add overhead and profit at the bottom; some do both. Two percentages on
 * the estimate — overhead on the lines' price subtotal, profit on the subtotal
 * plus overhead, the "ten and ten" of the trade — cover all three with zeros,
 * and a business that wants contingency writes it as a line.
 *
 * ── AN ESTIMATE BELONGS TO THE JOB AND MAY BECOME A CONTRACT ────────────────
 *
 * Numbered per job, as the business numbers them; several per job, because a
 * bid is revised and a design-phase estimate precedes the build. Accepting one
 * names the contract it priced, and from there the pack's other verbs take
 * over: the budget by code, the schedule of values by line, the value on the
 * contract. Nothing here bills.
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
import { jobProjects, jobCostCodes } from "./jobs";
import { jobContracts } from "./jobs-contracts";

export const jobEstimates = pgTable(
  "job_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The agreement this estimate priced, once it has one. */
    contractId: uuid("contract_id"),
    /** As the business numbers them: `EST-2`, `Bid 24-108 R3`. Unique per job. */
    number: text("number").notNull(),
    title: text("title").notNull().default(""),
    /** text + CHECK: draft, sent, accepted, declined, superseded. */
    status: text("status").notNull().default("draft"),
    sentOn: date("sent_on", { mode: "string" }),
    decidedOn: date("decided_on", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    /** The markup a line takes when it names none, in ppm. */
    markupPpm: integer("markup_ppm").notNull().default(0),
    /** Overhead on the lines' price subtotal, in ppm. */
    overheadPpm: integer("overhead_ppm").notNull().default(0),
    /** Profit on the subtotal plus overhead, in ppm. */
    profitPpm: integer("profit_ppm").notNull().default(0),
    notes: text("notes").notNull().default(""),
    /**
     * THE PROPOSAL (ADR 0070): how the price is shown to the client — line by
     * line, by cost code, by the client-facing groups (ADR 0079) or one sum —
     * and the three texts around it. The
     * words are the agreement's, so they are fixed with the money once the
     * estimate is accepted; the presentation is a printing choice and stays
     * free. A new estimate starts with the last one's terms.
     */
    presentation: text("presentation").notNull().default("lines"),
    scope: text("scope").notNull().default(""),
    exclusions: text("exclusions").notNull().default(""),
    terms: text("terms").notNull().default(""),
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
    uniqueIndex("job_estimates_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_estimates_project_number_idx").on(t.tenantId, t.projectId, t.number),
    index("job_estimates_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_estimates_tenant_contract_idx").on(t.tenantId, t.contractId),
    /** A job's estimates are part of it. */
    foreignKey({
      name: "job_estimates_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** NO ACTION: the contract an estimate priced stays; the job's cascade takes both together. */
    foreignKey({
      name: "job_estimates_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }),
    check("job_estimates_number_present", sql`length(btrim(${t.number})) > 0`),
    check(
      "job_estimates_status_valid",
      sql`${t.status} in ('draft', 'sent', 'accepted', 'declined', 'superseded')`,
    ),
    /** 'groups' joined the three in ADR 0079: the items the client buys. */
    check(
      "job_estimates_presentation_valid",
      sql`${t.presentation} in ('lines', 'codes', 'groups', 'sum')`,
    ),
    check("job_estimates_markup_range", sql`${t.markupPpm} >= 0 and ${t.markupPpm} <= 10000000`),
    check("job_estimates_overhead_range", sql`${t.overheadPpm} >= 0 and ${t.overheadPpm} <= 10000000`),
    check("job_estimates_profit_range", sql`${t.profitPpm} >= 0 and ${t.profitPpm} <= 10000000`),
  ],
);

/**
 * A GROUP IS THE ITEM THE CLIENT BUYS (ADR 0079): "Tile flooring, master and
 * hall baths", with the material, the labour and the thinset behind it. One
 * level deep on purpose — a builder who wants a third writes two groups.
 *
 * Its price either ROLLS UP from its lines, each riding the estimate's
 * overhead and profit as any line does, or is FIXED: the number the client
 * pays, typed, and excluded from the overhead-and-profit spread so that the
 * number typed is the number printed. A lump the business wants COSTED and
 * marked up is a line of quantity one, ADR 0069's rule; this is the other
 * question. The cost is always the lines', so the group's own margin — its
 * price less what is behind it — is there to read.
 */
export const jobEstimateGroups = pgTable(
  "job_estimate_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    /** What the client reads. The lines keep the estimator's shorthand. */
    name: text("name").notNull(),
    /** One paragraph under the item on the proposal; the brochure's narrative, later. */
    clientNote: text("client_note").notNull().default(""),
    /** text + CHECK: rollup (the children sum) or fixed (the price is typed). */
    priceMode: text("price_mode").notNull().default("rollup"),
    /** The price the client pays, on a fixed group; null on a rollup, by CHECK. */
    fixedPriceCents: bigint("fixed_price_cents", { mode: "number" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_groups_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_groups_tenant_estimate_idx").on(t.tenantId, t.estimateId, t.sortOrder),
    /** An estimate's groups are part of it. */
    foreignKey({
      name: "job_estimate_groups_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    check("job_estimate_groups_name_present", sql`length(btrim(${t.name})) > 0`),
    check("job_estimate_groups_name_bounded", sql`char_length(${t.name}) <= 200`),
    check("job_estimate_groups_note_bounded", sql`char_length(${t.clientNote}) <= 4000`),
    check("job_estimate_groups_price_mode_valid", sql`${t.priceMode} in ('rollup', 'fixed')`),
    /** The mode and the number say the same thing or the row is refused. */
    check(
      "job_estimate_groups_fixed_priced",
      sql`(${t.priceMode} = 'fixed') = (${t.fixedPriceCents} is not null)`,
    ),
    check(
      "job_estimate_groups_fixed_nonnegative",
      sql`${t.fixedPriceCents} is null or ${t.fixedPriceCents} >= 0`,
    ),
  ],
);

/**
 * One line of an estimate: a quantity of a unit at a cost, and what it sells
 * for. `quantity_thousandths` is 1,000 — one — for a lump sum, so every line
 * is the same arithmetic. The extended figures are never stored.
 */
export const jobEstimateLines = pgTable(
  "job_estimate_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    /** The client-facing item this line is part of; null makes it loose (ADR 0079). */
    groupId: uuid("group_id"),
    /** Where the cost lands in the budget; null while the chart is not built. */
    costCodeId: uuid("cost_code_id"),
    description: text("description").notNull(),
    /** "sf", "lf", "cy", "ea", "ls" — the business's own abbreviation; free text. */
    unit: text("unit").notNull().default(""),
    /** In thousandths, the grain estimating works to (ADR 0064). */
    quantityThousandths: bigint("quantity_thousandths", { mode: "number" }).notNull().default(1000),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull().default(0),
    /** This line's markup on cost, in ppm; null takes the estimate's default. */
    markupPpm: integer("markup_ppm"),
    /** An explicit price per unit, which overrides the markup: how a unit-price bid is written. */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
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
    uniqueIndex("job_estimate_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_lines_tenant_estimate_idx").on(t.tenantId, t.estimateId, t.sortOrder),
    index("job_estimate_lines_tenant_code_idx").on(t.tenantId, t.costCodeId),
    index("job_estimate_lines_tenant_group_idx").on(t.tenantId, t.groupId),
    /** An estimate's lines are part of it. */
    foreignKey({
      name: "job_estimate_lines_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("group_id")`: a bare
    // SET NULL would try to null tenant_id too and can never run on a composite key. A group deleted
    // leaves its lines loose, which is what ungrouping means; it never destroys the pricing.
    foreignKey({
      name: "job_estimate_lines_group_fk",
      columns: [t.tenantId, t.groupId],
      foreignColumns: [jobEstimateGroups.tenantId, jobEstimateGroups.id],
    }).onDelete("set null"),
    /** RESTRICT: a code with estimates against it is retired, never deleted. */
    foreignKey({
      name: "job_estimate_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    check("job_estimate_lines_description_present", sql`length(btrim(${t.description})) > 0`),
    check("job_estimate_lines_quantity_nonnegative", sql`${t.quantityThousandths} >= 0`),
    check("job_estimate_lines_unit_cost_nonnegative", sql`${t.unitCostCents} >= 0`),
    check(
      "job_estimate_lines_unit_price_nonnegative",
      sql`${t.unitPriceCents} is null or ${t.unitPriceCents} >= 0`,
    ),
    check(
      "job_estimate_lines_markup_range",
      sql`${t.markupPpm} is null or (${t.markupPpm} >= 0 and ${t.markupPpm} <= 10000000)`,
    ),
  ],
);

export type JobEstimate = typeof jobEstimates.$inferSelect;
export type JobEstimateGroup = typeof jobEstimateGroups.$inferSelect;
export type JobEstimateLine = typeof jobEstimateLines.$inferSelect;
