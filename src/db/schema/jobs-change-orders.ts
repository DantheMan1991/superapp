/**
 * Change orders — the one legitimate way a contract value or a budget moves.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The reporting line every owner and
 * surety reads on every pay application is
 *
 *   original + approved changes = revised
 *
 * and it is true of both halves of a job at once: a change order has a PRICE to
 * the owner (the revenue side, on the header) and an estimated COST by cost code
 * (the budget side, on the lines). They are different numbers — the price
 * carries the markup — and a model that stored one and derived the other would
 * be wrong on every job where the markup is not a flat percentage, which is all
 * of them.
 *
 * ── A CHANGE ORDER BELONGS TO A CONTRACT, NOT A PROJECT ─────────────────────
 *
 * Because it changes ONE agreement. A custom home on its third of three
 * contracts has a change order against the New Home contract, not against the
 * concept-design agreement it grew out of, and the pay application it appears on
 * is that contract's. `project_id` is reachable through the contract and is
 * deliberately not duplicated here.
 *
 * ── "REVISED" IS COMPUTED, NEVER STORED ─────────────────────────────────────
 *
 * `job_contracts.value_cents` stays the ORIGINAL and `job_budget_lines
 * .original_cents` was named for exactly this moment. Revised is original plus
 * the sum of APPROVED change orders, computed wherever it is shown. A stored
 * `revised_cents` would be one more column that could disagree with the rows it
 * summarises, and nothing would be gained: the sum is one indexed query.
 *
 * ── THE FIRST MONEY IN THIS PACK THAT MAY BE NEGATIVE ───────────────────────
 *
 * Every other amount here carries a non-negative CHECK. A change order does not,
 * on purpose: a DEDUCTIVE change order — the owner drops the pool, the contract
 * goes down — is ordinary, and the line for it is a negative number rather than
 * a separate "credit" concept. Both the header value and each cost line may be
 * negative, and a change order may have a positive price and a negative cost
 * line (scope moved between trades) or the reverse.
 *
 * ── WHAT "APPROVED" LOCKS ───────────────────────────────────────────────────
 *
 * Nothing here — but a SIGNED contract's `value_cents` becomes read-only in
 * `updateContract`, because a value that can still be edited in place makes the
 * "original" half of the line meaningless. A typo in a signed value is
 * corrected by a change order, which is what a real business does. The budget
 * is NOT locked the same way: it is an internal plan, not an agreement with
 * another party, and that asymmetry is the point rather than an oversight.
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
import { jobCostCodes } from "./jobs";
import { jobContracts } from "./jobs-contracts";

export const jobChangeOrders = pgTable(
  "job_change_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull(),
    /** As the business numbers them: `CO-3`, `PCO 12`, `7`. Unique per contract. */
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /**
     * text + CHECK, never a pgEnum. `proposed` is a PCO — priced and put to the
     * owner; `approved` is the only status whose money counts; `declined` is the
     * owner saying no; `void` is withdrawn before anybody answered.
     */
    status: text("status").notNull().default("proposed"),
    /**
     * The change to the CONTRACT VALUE, in cents. What the owner pays for the
     * change, markup included. May be negative — see the file header.
     */
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    requestedOn: date("requested_on", { mode: "string" }),
    approvedOn: date("approved_on", { mode: "string" }),
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
    uniqueIndex("job_change_orders_tenant_id_id_idx").on(t.tenantId, t.id),
    /** Numbered per CONTRACT, which is how they appear on its pay applications. */
    uniqueIndex("job_change_orders_contract_number_idx").on(
      t.tenantId,
      t.contractId,
      t.number,
    ),
    index("job_change_orders_tenant_contract_idx").on(t.tenantId, t.contractId),
    index("job_change_orders_tenant_status_idx").on(t.tenantId, t.status),
    /** A contract's change orders are part of it. */
    foreignKey({
      name: "job_change_orders_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }).onDelete("cascade"),
    check("job_change_orders_number_present", sql`length(btrim(${t.number})) > 0`),
    check("job_change_orders_title_present", sql`length(btrim(${t.title})) > 0`),
    check(
      "job_change_orders_status_valid",
      sql`${t.status} in ('proposed', 'approved', 'declined', 'void')`,
    ),
    /**
     * An approved change order has an approval date, and an unapproved one does
     * not. The date is the evidence, and a status that can be flipped without it
     * is a status nobody has to justify. Enforced here rather than in the action
     * so a row cannot be put into the state by any path.
     */
    check(
      "job_change_orders_approved_has_date",
      sql`(${t.status} = 'approved') = (${t.approvedOn} is not null)`,
    ),
  ],
);

/**
 * The cost side of a change order: how much it moves each cost code's budget.
 *
 * A change order with no lines is a pure price change — legitimate (a
 * negotiated increase with no extra scope) — so unlike a commitment, zero lines
 * is allowed. A change order whose header value is zero and whose lines move
 * cost between codes is also legitimate: scope transferred from one trade to
 * another at no charge to the owner.
 */
export const jobChangeOrderLines = pgTable(
  "job_change_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    changeOrderId: uuid("change_order_id").notNull(),
    costCodeId: uuid("cost_code_id").notNull(),
    description: text("description").notNull().default(""),
    /** The change to this code's budget, in cents. May be negative. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_change_order_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_change_order_lines_tenant_co_idx").on(
      t.tenantId,
      t.changeOrderId,
      t.sortOrder,
    ),
    index("job_change_order_lines_tenant_code_idx").on(t.tenantId, t.costCodeId),
    foreignKey({
      name: "job_change_order_lines_co_fk",
      columns: [t.tenantId, t.changeOrderId],
      foreignColumns: [jobChangeOrders.tenantId, jobChangeOrders.id],
    }).onDelete("cascade"),
    /** RESTRICT: a code with a change against it is retired, never deleted. */
    foreignKey({
      name: "job_change_order_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
  ],
);

export type JobChangeOrder = typeof jobChangeOrders.$inferSelect;
export type JobChangeOrderLine = typeof jobChangeOrderLines.$inferSelect;
