import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobCostCodes } from "./jobs";
import { jobCommitments } from "./jobs-commitments";
import { jobSubApplications } from "./jobs-sub-billing";
import { jobWarrantyClaims } from "./jobs-warranty";
import { tenants } from "./platform";

/**
 * A back-charge (ADR 0077): money the business spent that was the
 * subcontractor's to spend, deducted from what it pays them.
 *
 * ── NOT A CHANGE ORDER, WHICH IS WHY IT IS ITS OWN TABLE ────────────────────
 *
 * [ADR 0065](../../../docs/decisions/0065-a-subcontract-change-order-is-the-orders-own-lines-tagged-with-it.md)
 * left this open and said what it is not: a back-charge does not change the
 * scope of the order, so it is not a deductive change order. The order still
 * says what the subcontractor agreed to do for what money; the back-charge
 * says the business paid for part of it and is keeping the difference.
 * Recording it as a scope deduction would quietly restate the agreement.
 *
 * ── IT HANGS OFF THE ORDER, BECAUSE THAT IS WHERE IT COMES OFF ──────────────
 *
 * `commitment_id` names both the subcontractor and the job. The deduction
 * lands on one of that order's applications: `sub_application_id` while it
 * sits on one, and where it stands is DERIVED from that application's status
 * (`backChargeStanding`) rather than stored — the rule the punch list, the
 * lien waiver and the warranty claim all follow.
 *
 * ── THE MONEY ALREADY LANDED ON THE JOB ─────────────────────────────────────
 *
 * The business paid somebody, so the cost is already on the job under a code.
 * `cost_code_id` names that code, and the deduction goes back to it as a
 * negative line on the subcontractor's bill — so the job cost report's spend
 * on that code nets out, which is the figure a builder actually reads. The
 * key SETS NULL (column-list form) rather than cascading: a code retired
 * leaves the back-charge, which is a payment record and not a budget line.
 *
 * ── AND IT MAY COME FROM A WARRANTY CLAIM ───────────────────────────────────
 *
 * A claim names the trade held responsible (ADR 0076). When the business
 * fixes that trade's work itself, the cost of the fix is the canonical
 * back-charge, and `warranty_claim_id` remembers which call it came from.
 * SET NULL again: a claim removed leaves the money owed.
 */
export const jobBackCharges = pgTable(
  "job_back_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The order it comes off, which names the subcontractor and the job. */
    commitmentId: uuid("commitment_id").notNull(),
    /** 1, 2, 3… per order, in the order raised: how it is referred to out loud. */
    number: integer("number").notNull(),
    /** What the business paid for on their behalf, in the business's words. */
    description: text("description").notNull(),
    /**
     * What is being kept back, ALWAYS POSITIVE. A back-charge only ever runs
     * one way; money owed the other way is an application, and one raised in
     * error is voided rather than negated.
     */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** The code the cost landed on, so the deduction nets against it on the job cost report. */
    costCodeId: uuid("cost_code_id"),
    /** The day the business spent it. */
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    /** The warranty claim it came from, while that claim exists. */
    warrantyClaimId: uuid("warranty_claim_id"),
    /** The application it is being deducted on, while it sits on one. */
    subApplicationId: uuid("sub_application_id"),
    /**
     * `open` | `void` — and nothing else, because deducted is DERIVED from
     * the application. `void` is the back-charge raised in error or conceded
     * to the subcontractor, kept because they will ask about it.
     */
    status: text("status").notNull().default("open"),
    /** Why it was voided, or dropped. */
    voidReason: text("void_reason").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_back_charges_tenant_id_id_idx").on(t.tenantId, t.id),
    /** A number is once per order. */
    uniqueIndex("job_back_charges_number_idx").on(t.tenantId, t.commitmentId, t.number),
    index("job_back_charges_tenant_commitment_idx").on(t.tenantId, t.commitmentId),
    index("job_back_charges_tenant_application_idx").on(t.tenantId, t.subApplicationId),
    index("job_back_charges_tenant_claim_idx").on(t.tenantId, t.warrantyClaimId),
    foreignKey({
      name: "job_back_charges_commitment_fk",
      columns: [t.tenantId, t.commitmentId],
      foreignColumns: [jobCommitments.tenantId, jobCommitments.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("cost_code_id")`: a bare
    // SET NULL would try to null tenant_id too and can never run on a composite key.
    foreignKey({
      name: "job_back_charges_cost_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }).onDelete("set null"),
    // The same column-list SET NULL: a claim removed leaves the money owed.
    foreignKey({
      name: "job_back_charges_claim_fk",
      columns: [t.tenantId, t.warrantyClaimId],
      foreignColumns: [jobWarrantyClaims.tenantId, jobWarrantyClaims.id],
    }).onDelete("set null"),
    // And again: a DRAFT application deleted frees its back-charges for the next one.
    // A billed application is voided, never deleted, and voiding clears the link itself.
    foreignKey({
      name: "job_back_charges_application_fk",
      columns: [t.tenantId, t.subApplicationId],
      foreignColumns: [jobSubApplications.tenantId, jobSubApplications.id],
    }).onDelete("set null"),
    check("job_back_charges_number_positive", sql`${t.number} > 0`),
    check("job_back_charges_amount_positive", sql`${t.amountCents} > 0`),
    check("job_back_charges_description_present", sql`length(btrim(${t.description})) > 0`),
    check("job_back_charges_status_valid", sql`${t.status} in ('open', 'void')`),
    /** A voided back-charge is off every application: the two states cannot both be true. */
    check("job_back_charges_void_is_off", sql`${t.status} = 'open' or ${t.subApplicationId} is null`),
    check("job_back_charges_description_bounded", sql`char_length(${t.description}) <= 300`),
    check("job_back_charges_void_reason_bounded", sql`char_length(${t.voidReason}) <= 2000`),
    check("job_back_charges_notes_bounded", sql`char_length(${t.notes}) <= 4000`),
  ],
);

export type JobBackCharge = typeof jobBackCharges.$inferSelect;
export type NewJobBackCharge = typeof jobBackCharges.$inferInsert;
