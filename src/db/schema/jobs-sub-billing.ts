/**
 * Subcontractor pay applications — the payable-side mirror of progress
 * billing, and where retainage HELD FROM a subcontractor lives.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 5c. A subcontractor bills the
 * business the way the business bills its client: an application against the
 * subcontract saying how much of each line is complete to date, less the
 * retainage the business holds back, less what earlier applications already
 * certified. The G702 again — read from the other side of the table.
 *
 * ── THE SUBCONTRACT'S LINES ARE THE SCHEDULE OF VALUES ──────────────────────
 *
 * A fixed-price contract needed a schedule of values before it could be
 * billed. A subcontract already HAS one: `job_commitment_lines` — a cost code
 * and an amount per line, written when the order was placed. An application
 * carries one line per commitment line, and the arithmetic is
 * `payApplicationTotals`, unchanged.
 *
 * ── AN APPROVED APPLICATION IS AN ORDINARY BILL (ADR 0061) ──────────────────
 *
 * Approving posts through Accounting's own verbs — a bill draft with a line
 * per commitment line for the work this period (to the subcontract expense
 * account, tagged with the job AND the line's cost code, which is how the
 * job cost report's `Spent` column and the next cost-plus application both
 * see it) and a NEGATIVE line to `2120 Retainage Payable` for what is held
 * back — then `approveBill`. Dr expense (gross) · Cr Retainage Payable (held)
 * · Cr AP (net): the entry every contractor's accountant expects. AP, aging,
 * payments and the cash lens see a bill; nothing here is a second ledger.
 * `bill_id` is the link, and the pack never reads Accounting's tables to
 * follow it.
 *
 * Releasing what was held is the same line running the other way: a later
 * application at a lower rate computes less retainage to date than the last
 * one held, the line to `2120` is positive, and the bill pays it out.
 *
 * ── SUBCONTRACTS ONLY ───────────────────────────────────────────────────────
 *
 * A purchase order is billed with an ordinary bill in Accounting; retainage,
 * lien waivers and certified payroll attach to bought labour, not to bought
 * material — the reason `job_commitments.kind` is a CHECK list of two. The
 * verb refuses a purchase order; the database does not know the difference,
 * which is a compensating control the ops test proves.
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
import { bills } from "./payables";
import { jobCommitments, jobCommitmentLines } from "./jobs-commitments";

/**
 * A subcontractor's application against a subcontract, numbered per
 * commitment in the order they arrived.
 *
 * `status`: `draft` while its lines are being filled in; `billed` once it
 * has been posted as a bill; `void` when that bill was voided. Whether the
 * subcontractor has been PAID is the bill's business, read from it.
 *
 * The five `*_cents` totals are FROZEN at approval and zero on a draft, the
 * rule a pay application's follow.
 */
export const jobSubApplications = pgTable(
  "job_sub_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    commitmentId: uuid("commitment_id").notNull(),
    number: integer("number").notNull(),
    status: text("status").notNull().default("draft"),
    /** The end of the period the subcontractor's application covers. */
    periodTo: date("period_to", { mode: "string" }).notNull(),
    /** What the business holds back, in parts per million (10% = 100_000). */
    retainagePpm: integer("retainage_ppm").notNull().default(0),
    /** Σ of the subcontract's lines at approval — the sum the certificate is against. */
    scheduledCents: bigint("scheduled_cents", { mode: "number" }).notNull().default(0),
    completedToDateCents: bigint("completed_to_date_cents", { mode: "number" })
      .notNull()
      .default(0),
    retainageCents: bigint("retainage_cents", { mode: "number" }).notNull().default(0),
    previousCertificatesCents: bigint("previous_certificates_cents", { mode: "number" })
      .notNull()
      .default(0),
    /** Current payment due — what the bill was approved for. */
    dueCents: bigint("due_cents", { mode: "number" }).notNull().default(0),
    /** The Accounting bill this application became at approval. */
    billId: uuid("bill_id"),
    billedOn: date("billed_on", { mode: "string" }),
    /** The subcontractor's own invoice number, when they gave one. Goes on the bill. */
    reference: text("reference").notNull().default(""),
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
    uniqueIndex("job_sub_applications_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_sub_applications_commitment_number_idx").on(
      t.tenantId,
      t.commitmentId,
      t.number,
    ),
    index("job_sub_applications_tenant_commitment_idx").on(t.tenantId, t.commitmentId),
    foreignKey({
      name: "job_sub_applications_commitment_fk",
      columns: [t.tenantId, t.commitmentId],
      foreignColumns: [jobCommitments.tenantId, jobCommitments.id],
    }).onDelete("cascade"),
    /** RESTRICT: a bill an application became is voided, never deleted. */
    foreignKey({
      name: "job_sub_applications_bill_fk",
      columns: [t.tenantId, t.billId],
      foreignColumns: [bills.tenantId, bills.id],
    }),
    check(
      "job_sub_applications_status_valid",
      sql`${t.status} in ('draft', 'billed', 'void')`,
    ),
    check(
      "job_sub_applications_retainage_range",
      sql`${t.retainagePpm} >= 0 and ${t.retainagePpm} <= 1000000`,
    ),
    check("job_sub_applications_number_positive", sql`${t.number} > 0`),
    /** A billed application is a bill; a draft is not. Both ways. */
    check(
      "job_sub_applications_billed_has_bill",
      sql`(${t.status} = 'draft') = (${t.billId} is null)`,
    ),
  ],
);

/**
 * One line of a subcontractor's application, against one line of the
 * subcontract. The same three figures as a pay application's line —
 * carried, typed, stored — with the same floor.
 */
export const jobSubApplicationLines = pgTable(
  "job_sub_application_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subApplicationId: uuid("sub_application_id").notNull(),
    commitmentLineId: uuid("commitment_line_id").notNull(),
    /** The subcontract line's amount as this application saw it; frozen at approval. */
    scheduledCents: bigint("scheduled_cents", { mode: "number" }).notNull().default(0),
    previousCents: bigint("previous_cents", { mode: "number" }).notNull().default(0),
    thisPeriodCents: bigint("this_period_cents", { mode: "number" }).notNull().default(0),
    storedCents: bigint("stored_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_sub_application_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_sub_application_lines_app_line_idx").on(
      t.tenantId,
      t.subApplicationId,
      t.commitmentLineId,
    ),
    index("job_sub_application_lines_tenant_app_idx").on(t.tenantId, t.subApplicationId),
    foreignKey({
      name: "job_sub_application_lines_app_fk",
      columns: [t.tenantId, t.subApplicationId],
      foreignColumns: [jobSubApplications.tenantId, jobSubApplications.id],
    }).onDelete("cascade"),
    /**
     * RESTRICT: a subcontract line that has been billed against cannot go.
     * `updateCommitment` REPLACES lines on edit, so this is the backstop that
     * turns "edit the lines of a billed subcontract" into a refusal rather
     * than a silent loss of what was certified.
     */
    foreignKey({
      name: "job_sub_application_lines_commitment_line_fk",
      columns: [t.tenantId, t.commitmentLineId],
      foreignColumns: [jobCommitmentLines.tenantId, jobCommitmentLines.id],
    }),
    check("job_sub_application_lines_previous_nonnegative", sql`${t.previousCents} >= 0`),
    check("job_sub_application_lines_stored_nonnegative", sql`${t.storedCents} >= 0`),
    check(
      "job_sub_application_lines_completed_nonnegative",
      sql`${t.previousCents} + ${t.thisPeriodCents} + ${t.storedCents} >= 0`,
    ),
  ],
);

export type JobSubApplication = typeof jobSubApplications.$inferSelect;
export type JobSubApplicationLine = typeof jobSubApplicationLines.$inferSelect;
