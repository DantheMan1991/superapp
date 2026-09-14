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
    description: text("description").notNull().default(""),
    /** Committed amount in cents. Never negative: a credit is a change order. */
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
    check("job_commitment_lines_amount_nonnegative", sql`${t.amountCents} >= 0`),
  ],
);

export type JobCommitment = typeof jobCommitments.$inferSelect;
export type JobCommitmentLine = typeof jobCommitmentLines.$inferSelect;
