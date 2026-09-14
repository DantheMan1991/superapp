/**
 * Progress billing — the schedule of values, and the pay applications drawn
 * against it.
 *
 * Part of the `jobs` pack (Layer 2a, P4). The first slice of this pack that
 * BILLS, and it bills the way every contractor bills a fixed-price job: a
 * SCHEDULE OF VALUES breaks the contract sum into lines (trades, phases, or
 * milestones — the AIA G703 shape, which is also a home's draw schedule with
 * different words), and each PAY APPLICATION says how much of each line is
 * complete to date. The G702 arithmetic then falls out:
 *
 *   completed and stored to date
 *   − retainage                        = total earned less retainage
 *   − previous certificates for payment = CURRENT PAYMENT DUE
 *
 * ── ONE MODEL FOR THREE BILLING METHODS ─────────────────────────────────────
 *
 * The pilot bills fixed price monthly on progress, AIA pay applications, and a
 * milestone draw schedule for homes. All three are percent-or-milestone
 * against a fixed value: a monthly draw is a schedule of one or a few lines
 * with a percent each; an AIA application is the full G703; a draw schedule is
 * lines that are milestones, each billed whole when reached. Cost-plus, unit
 * price and time-and-materials are DIFFERENT sums and are not here.
 *
 * ── AN ISSUED APPLICATION IS AN ORDINARY INVOICE (ADR 0058) ─────────────────
 *
 * Issuing posts through Accounting's own verbs — a draft invoice with a line
 * for the work earned this period and a NEGATIVE line for the retainage
 * withheld, to the retainage receivable — so AR, aging, reminders, payments,
 * statements and the cash-basis lens all work with no second ledger.
 * `invoice_id` is the link, and this pack never reads Accounting's tables to
 * follow it: it calls Accounting's document verbs.
 *
 * ── THE TOTALS ON AN ISSUED APPLICATION ARE FROZEN ──────────────────────────
 *
 * Like an invoice's tax, like a change order's price: the G702 a client signed
 * must read the same next year, whatever the schedule of values has become.
 * A draft's totals are computed live from its lines; issuing writes them down.
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
import { invoices } from "./invoicing";
import { jobCostCodes } from "./jobs";
import { jobContracts } from "./jobs-contracts";
import { jobChangeOrders } from "./jobs-change-orders";

/**
 * One line of a contract's schedule of values.
 *
 * `scheduled_cents` is what the line is worth; the lines should sum to the
 * contract's revised value and the page says so when they do not, rather than
 * a CHECK enforcing it — a schedule is built up before it is complete, and an
 * approved change order adds lines of its own (`change_order_id` says which).
 */
export const jobSovLines = pgTable(
  "job_sov_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description").notNull(),
    scheduledCents: bigint("scheduled_cents", { mode: "number" }).notNull(),
    /** The trade this line is, when the schedule is by trade. Optional: a draw milestone is not a trade. */
    costCodeId: uuid("cost_code_id"),
    /** Set when an approved change order put this line on the schedule. */
    changeOrderId: uuid("change_order_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_sov_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_sov_lines_tenant_contract_idx").on(t.tenantId, t.contractId, t.sortOrder),
    foreignKey({
      name: "job_sov_lines_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }).onDelete("cascade"),
    /** RESTRICT: a code named on a schedule is retired, never deleted. */
    foreignKey({
      name: "job_sov_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    foreignKey({
      name: "job_sov_lines_change_order_fk",
      columns: [t.tenantId, t.changeOrderId],
      foreignColumns: [jobChangeOrders.tenantId, jobChangeOrders.id],
    }).onDelete("cascade"),
    check("job_sov_lines_description_present", sql`length(btrim(${t.description})) > 0`),
    check("job_sov_lines_scheduled_nonnegative", sql`${t.scheduledCents} >= 0`),
  ],
);

/**
 * A pay application: one draw against a contract, numbered per contract in
 * the order they were made.
 *
 * `status`: `draft` while its lines are being filled in; `issued` once it has
 * been posted as an invoice; `void` when that invoice was voided. There is no
 * `paid` — whether the client has paid is the INVOICE's business, read from it.
 *
 * Retainage is a rate in parts per million (10% = 100_000), the convention
 * `sales_tax_rates.rate_ppm` set, applied to everything completed and stored
 * to date. The five `*_cents` totals are FROZEN at issue and zero on a draft.
 */
export const jobPayApplications = pgTable(
  "job_pay_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull(),
    number: integer("number").notNull(),
    status: text("status").notNull().default("draft"),
    /** The end of the period this application covers. */
    periodTo: date("period_to", { mode: "string" }).notNull(),
    retainagePpm: integer("retainage_ppm").notNull().default(0),
    /** Σ of the schedule's lines at issue — the contract sum the G702 is against. */
    scheduledCents: bigint("scheduled_cents", { mode: "number" }).notNull().default(0),
    /** Work completed plus materials stored, to date, at issue. */
    completedToDateCents: bigint("completed_to_date_cents", { mode: "number" })
      .notNull()
      .default(0),
    /** Retainage held to date, at issue. */
    retainageCents: bigint("retainage_cents", { mode: "number" }).notNull().default(0),
    /** What earlier applications on this contract had already certified (earned less retainage). */
    previousCertificatesCents: bigint("previous_certificates_cents", { mode: "number" })
      .notNull()
      .default(0),
    /** Current payment due — what the invoice was issued for. */
    dueCents: bigint("due_cents", { mode: "number" }).notNull().default(0),
    /** The Accounting invoice this application became at issue. */
    invoiceId: uuid("invoice_id"),
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
    uniqueIndex("job_pay_applications_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_pay_applications_contract_number_idx").on(
      t.tenantId,
      t.contractId,
      t.number,
    ),
    index("job_pay_applications_tenant_contract_idx").on(t.tenantId, t.contractId),
    foreignKey({
      name: "job_pay_applications_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }).onDelete("cascade"),
    /** RESTRICT: an invoice an application became is voided, never deleted. */
    foreignKey({
      name: "job_pay_applications_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check(
      "job_pay_applications_status_valid",
      sql`${t.status} in ('draft', 'issued', 'void')`,
    ),
    check(
      "job_pay_applications_retainage_range",
      sql`${t.retainagePpm} >= 0 and ${t.retainagePpm} <= 1000000`,
    ),
    check("job_pay_applications_number_positive", sql`${t.number} > 0`),
    /** An issued application is an invoice; a draft is not. Both ways. */
    check(
      "job_pay_applications_issued_has_invoice",
      sql`(${t.status} = 'draft') = (${t.invoiceId} is null)`,
    ),
  ],
);

/**
 * One line of a pay application, against one line of the schedule.
 *
 * `previous_cents` is work completed on earlier applications (carried forward
 * by the pack, never typed); `this_period_cents` is what was completed this
 * period and may be NEGATIVE — an over-billing on an earlier application is
 * corrected here, which is how the G703 has always worked; `stored_cents` is
 * materials on site not yet installed, entered fresh each period. Completed to
 * date is the three summed and may not go below zero.
 */
export const jobPayApplicationLines = pgTable(
  "job_pay_application_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    payApplicationId: uuid("pay_application_id").notNull(),
    sovLineId: uuid("sov_line_id").notNull(),
    /** The schedule line's value as this application saw it; frozen at issue. */
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
    uniqueIndex("job_pay_application_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_pay_application_lines_app_sov_idx").on(
      t.tenantId,
      t.payApplicationId,
      t.sovLineId,
    ),
    index("job_pay_application_lines_tenant_app_idx").on(t.tenantId, t.payApplicationId),
    foreignKey({
      name: "job_pay_application_lines_app_fk",
      columns: [t.tenantId, t.payApplicationId],
      foreignColumns: [jobPayApplications.tenantId, jobPayApplications.id],
    }).onDelete("cascade"),
    /** RESTRICT: a schedule line that has been billed against cannot go. */
    foreignKey({
      name: "job_pay_application_lines_sov_fk",
      columns: [t.tenantId, t.sovLineId],
      foreignColumns: [jobSovLines.tenantId, jobSovLines.id],
    }),
    check("job_pay_application_lines_previous_nonnegative", sql`${t.previousCents} >= 0`),
    check("job_pay_application_lines_stored_nonnegative", sql`${t.storedCents} >= 0`),
    check(
      "job_pay_application_lines_completed_nonnegative",
      sql`${t.previousCents} + ${t.thisPeriodCents} + ${t.storedCents} >= 0`,
    ),
  ],
);

export type JobSovLine = typeof jobSovLines.$inferSelect;
export type JobPayApplication = typeof jobPayApplications.$inferSelect;
export type JobPayApplicationLine = typeof jobPayApplicationLines.$inferSelect;
