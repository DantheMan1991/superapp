/**
 * Commitments — what the business has promised to pay somebody else.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The COST side, and the deliberate
 * mirror of `job_contracts`: a contract is what the business bills against, a
 * commitment is what it has ordered. Purchase orders and subcontracts are the
 * same row with a different `kind`.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * **Committed cost is the number a budget is useless without.** A job that has
 * spent $400k of a $1.8m contract looks healthy right up until you notice it has
 * also issued $1.5m of subcontracts. Actual cost answers "what has been billed";
 * committed answers "what is already owed whether or not the invoice has
 * arrived", and only the second one tells a builder whether the job is in
 * trouble. It is the single most common thing a spreadsheet gets wrong, because
 * a PO lives in one place and the ledger in another.
 *
 * ── HEADER AND LINES, AND WHY NOT A FLAT TABLE ──────────────────────────────
 *
 * A framing subcontract covers labour and materials, sometimes several cost
 * codes, under one agreement with one vendor and one number. Putting the value
 * and the cost code on the HEADER would have been half the work today and a
 * migration tomorrow — moving two columns off a table that already has rows in
 * it, which is exactly the "rewrite if deferred" this file exists to avoid. So
 * the header carries who and which number, and the money lives on lines.
 *
 * The UI offers one line by default, because one line is the common case.
 *
 * ── THE PARTY IS REQUIRED, UNLIKE A CONTRACT'S COUNTERPARTY ─────────────────
 *
 * A contract may be proposed before the other side is a record in the books — a
 * concept written for somebody who is not yet a customer is a real thing. **A
 * commitment with nobody to pay is not a commitment**, it is a budget line; so
 * `party_id` is NOT NULL here, and that asymmetry is the point rather than an
 * oversight.
 *
 * ── A CHANGE ORDER ADDS LINES TO THE ORDER IT CHANGES (slice 4b, ADR 0065) ──
 *
 * `job_commitment_change_orders` is the payable-side twin of
 * `job_change_orders`: a numbered, titled, dated document against ONE
 * commitment, whose money is lines in `job_commitment_lines` tagged with
 * `change_order_id`. The order's ORIGINAL lines carry null. Nothing is stored
 * twice: what an order is worth now is original + approved changes, summed from
 * the one table wherever it is shown, and a subcontractor's application bills a
 * change's lines exactly as it bills the original ones — they are the same rows.
 * A change may be DEDUCTIVE, a negative line: the only way a commitment line
 * goes below zero, and the CHECK says so.
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
import { parties } from "./parties";
import { jobProjects, jobCostCodes } from "./jobs";
import { jobChangeOrders } from "./jobs-change-orders";

export const jobCommitments = pgTable(
  "job_commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** Who is being paid. Required — see the file header. */
    partyId: uuid("party_id").notNull(),
    /**
     * A CHECK list of two, unlike a contract's `kind` which is an open taxonomy.
     * The difference is not taste: a subcontract and a purchase order diverge in
     * BEHAVIOUR later — retainage, lien waivers and certified payroll attach to
     * bought labour and not to bought material — so the pack has to be able to
     * tell them apart. What each is CALLED is a label; what each IS, is this.
     */
    kind: text("kind").notNull().default("purchase_order"),
    /** The PO or subcontract number, as the business writes it. */
    number: text("number").notNull(),
    description: text("description").notNull().default(""),
    /**
     * text + CHECK, never a pgEnum. `draft` is written but not sent; `issued` is
     * the one that counts as committed money; `closed` is finished and billed
     * out; `cancelled` never happened.
     */
    status: text("status").notNull().default("draft"),
    issuedOn: date("issued_on", { mode: "string" }),
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
    uniqueIndex("job_commitments_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * A PO number is how a vendor refers to it on the invoice they send back, so
     * two of them is a matching problem waiting to happen. One per tenant, not
     * per project: a business numbers its POs in one sequence.
     */
    uniqueIndex("job_commitments_tenant_number_idx").on(t.tenantId, t.number),
    index("job_commitments_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_commitments_tenant_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "job_commitments_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** No cascade: a vendor with commitments cannot be merged away underneath them. */
    foreignKey({
      name: "job_commitments_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_commitments_number_present", sql`length(btrim(${t.number})) > 0`),
    check(
      "job_commitments_kind_valid",
      sql`${t.kind} in ('purchase_order', 'subcontract')`,
    ),
    check(
      "job_commitments_status_valid",
      sql`${t.status} in ('draft', 'issued', 'closed', 'cancelled')`,
    ),
  ],
);

/**
 * A change to ONE commitment: the payable-side twin of `job_change_orders`.
 *
 * A subcontract change order, a purchase-order revision, a deductive change
 * and scope taken back are all this row: a number (as the business writes it,
 * unique per commitment), a title, a status and — when approved — the date.
 * Its MONEY is not here. It is the lines in `job_commitment_lines` that carry
 * this row's id, so an approved change's lines ARE the subcontract's lines and
 * a subcontractor's application bills them without a second schedule; a change
 * with no lines is legitimate (a time extension, a re-worded scope).
 *
 * `change_order_id` is the CLIENT-SIDE change order this one passes down, if
 * any — the owner's CO-3 that the electrician's SCO-1 is the electrical share
 * of. Nullable, because a change to a subcontract need not have been asked for
 * by the owner: a business absorbs plenty of its own. RESTRICT, so the link
 * cannot dangle; neither side has a delete verb.
 *
 * The statuses and the approval-date rule are the client-side ones, on
 * purpose: one vocabulary for "a change", read from `CHANGE_ORDER_STATUSES` by
 * both tables' mirror tests.
 */
export const jobCommitmentChangeOrders = pgTable(
  "job_commitment_change_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    /** The client's change order this one passes down, or null for a change of the business's own. */
    changeOrderId: uuid("change_order_id"),
    /** As the business numbers them: `SCO-1`, `PO-1042 R2`, `3`. Unique per commitment. */
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** text + CHECK, the client-side list: proposed, approved, declined, void. */
    status: text("status").notNull().default("proposed"),
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
    uniqueIndex("job_commitment_change_orders_tenant_id_id_idx").on(t.tenantId, t.id),
    /** Numbered per COMMITMENT: SCO-1 on the framer's subcontract and SCO-1 on the plumber's are two documents. */
    uniqueIndex("job_commitment_change_orders_commitment_number_idx").on(
      t.tenantId,
      t.commitmentId,
      t.number,
    ),
    index("job_commitment_change_orders_tenant_commitment_idx").on(t.tenantId, t.commitmentId),
    index("job_commitment_change_orders_tenant_status_idx").on(t.tenantId, t.status),
    /** A commitment's changes are part of it. */
    foreignKey({
      name: "job_commitment_change_orders_commitment_fk",
      columns: [t.tenantId, t.commitmentId],
      foreignColumns: [jobCommitments.tenantId, jobCommitments.id],
    }).onDelete("cascade"),
    /** RESTRICT: the client's change order a subcontract change passes down cannot go from under it. */
    foreignKey({
      name: "job_commitment_change_orders_change_order_fk",
      columns: [t.tenantId, t.changeOrderId],
      foreignColumns: [jobChangeOrders.tenantId, jobChangeOrders.id],
    }),
    check(
      "job_commitment_change_orders_number_present",
      sql`length(btrim(${t.number})) > 0`,
    ),
    check(
      "job_commitment_change_orders_title_present",
      sql`length(btrim(${t.title})) > 0`,
    ),
    check(
      "job_commitment_change_orders_status_valid",
      sql`${t.status} in ('proposed', 'approved', 'declined', 'void')`,
    ),
    /** Approved has a date and unapproved has none — the client-side rule, for the client-side reason. */
    check(
      "job_commitment_change_orders_approved_has_date",
      sql`(${t.status} = 'approved') = (${t.approvedOn} is not null)`,
    ),
  ],
);

/**
 * One cost code's worth of a commitment.
 *
 * **THE COST CODE IS WHAT MAKES THIS WORTH STORING.** A committed total with no
 * code tells a builder the job is over; a committed total BY code tells them
 * which trade it was, which is the difference between a number and an answer.
 */
export const jobCommitmentLines = pgTable(
  "job_commitment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    /**
     * Nullable, because a business that has not built its chart of cost yet
     * still needs to record what it has ordered. An uncoded line counts toward
     * the project's committed total and toward no code's.
     */
    costCodeId: uuid("cost_code_id"),
    /**
     * The change order that added this line, or null for a line the order was
     * placed with. A change's lines count only while the change is approved —
     * `countedCommitmentLine` in ops.ts — and a change that has been billed
     * against keeps them for good.
     */
    changeOrderId: uuid("change_order_id"),
    description: text("description").notNull().default(""),
    /**
     * Committed amount in cents. Never negative on an ORIGINAL line — a credit
     * is a change order — and a change order's line may be, because a
     * deductive change is a negative line and not a separate concept (ADR 0065).
     */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_commitment_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_commitment_lines_tenant_commitment_idx").on(
      t.tenantId,
      t.commitmentId,
      t.sortOrder,
    ),
    index("job_commitment_lines_tenant_code_idx").on(t.tenantId, t.costCodeId),
    index("job_commitment_lines_tenant_change_idx").on(t.tenantId, t.changeOrderId),
    /** A commitment's lines are part of it. */
    foreignKey({
      name: "job_commitment_lines_commitment_fk",
      columns: [t.tenantId, t.commitmentId],
      foreignColumns: [jobCommitments.tenantId, jobCommitments.id],
    }).onDelete("cascade"),
    /**
     * No cascade, i.e. RESTRICT. A cost code with money committed against it is
     * RETIRED, never deleted — `updateCostCode` has no delete verb precisely so
     * this cannot happen, and the key is the backstop that proves it.
     */
    foreignKey({
      name: "job_commitment_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    /** A change's lines are part of the change; taking one back that has been billed against is refused by the sub-application line's RESTRICT. */
    foreignKey({
      name: "job_commitment_lines_change_order_fk",
      columns: [t.tenantId, t.changeOrderId],
      foreignColumns: [jobCommitmentChangeOrders.tenantId, jobCommitmentChangeOrders.id],
    }).onDelete("cascade"),
    check(
      "job_commitment_lines_amount_nonnegative",
      sql`${t.amountCents} >= 0 or ${t.changeOrderId} is not null`,
    ),
  ],
);

export type JobCommitment = typeof jobCommitments.$inferSelect;
export type JobCommitmentChangeOrder = typeof jobCommitmentChangeOrders.$inferSelect;
export type JobCommitmentLine = typeof jobCommitmentLines.$inferSelect;
