/**
 * Lien waivers — the document a subcontractor or supplier signs to give up
 * its right to a lien in exchange for payment, tracked as a RECORD.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 11a of the construction plan
 * (`compliance`), and the next thing a general contractor's bookkeeper asks
 * for once retainage from subcontractors is tracked (ADR 0061): the owner and
 * the bank want a waiver from everybody paid before they fund the next draw,
 * and a payment made without one is the classic way a job ends up with a
 * lien on it and the money paid twice.
 *
 * ── A RECORD, NEVER A FORM (ADR 0066) ───────────────────────────────────────
 *
 * The words on a lien waiver are the state's — a dozen states mandate the
 * exact text, the rest use whatever the business's lawyer wrote — and a
 * business in Canada signs a statutory declaration instead. What every one of
 * them has in common is what this row keeps: WHO gives it (the claimant, any
 * party — usually the subcontractor, sometimes their supplier), on WHICH job
 * and under which of our orders, of which KIND, THROUGH which date, for HOW
 * MUCH, and whether it has been RECEIVED. The signed copy itself is a
 * Documents attachment on the row, the way a daily log's photos are.
 *
 * ── THE FOUR KINDS ──────────────────────────────────────────────────────────
 *
 * Conditional or unconditional, progress or final — the vocabulary every
 * American form uses. A CONDITIONAL waiver is given with the application and
 * takes effect when the payment clears; an UNCONDITIONAL one is given after
 * the money arrived and is the one the owner's bank wants to see. A business
 * whose state has no conditional form simply never records one.
 *
 * ── THE GAP IS DERIVED, NEVER STORED ────────────────────────────────────────
 *
 * "Paid, and no unconditional waiver on file" is computed from the
 * subcontractor's applications (which carry their bill, and so whether it was
 * paid) against the waivers received, per order, at read time. Nothing here
 * says "outstanding": a waiver that arrives closes the gap by existing.
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
import { jobProjects } from "./jobs";
import { jobCommitments } from "./jobs-commitments";
import { jobSubApplications } from "./jobs-sub-billing";

export const jobLienWaivers = pgTable(
  "job_lien_waivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The claimant: who gives up the lien right. Usually the order's party; a supplier of theirs may give one too. */
    partyId: uuid("party_id").notNull(),
    /** The subcontract or purchase order it is under, when it is one of ours. */
    commitmentId: uuid("commitment_id"),
    /** The subcontractor's application — the payment — it covers, when it is for one. Billed applications only (the verb checks). */
    subApplicationId: uuid("sub_application_id"),
    /** text + CHECK: conditional_progress, unconditional_progress, conditional_final, unconditional_final. */
    kind: text("kind").notNull(),
    /** Work through this date is waived. */
    throughDate: date("through_date", { mode: "string" }).notNull(),
    /** The payment the waiver names, in cents; 0 when the form states none (an unconditional final often does not). */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
    /** text + CHECK: requested (asked for), received (the signed copy is on file), void. */
    status: text("status").notNull().default("requested"),
    requestedOn: date("requested_on", { mode: "string" }),
    receivedOn: date("received_on", { mode: "string" }),
    /** Who signed for the claimant, as written on the form. */
    signedBy: text("signed_by").notNull().default(""),
    /** The claimant's own reference, if they number them. */
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
    uniqueIndex("job_lien_waivers_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_lien_waivers_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_lien_waivers_tenant_party_idx").on(t.tenantId, t.partyId),
    index("job_lien_waivers_tenant_commitment_idx").on(t.tenantId, t.commitmentId),
    index("job_lien_waivers_tenant_application_idx").on(t.tenantId, t.subApplicationId),
    /** A job's waivers are part of it. */
    foreignKey({
      name: "job_lien_waivers_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** No cascade: a party that has signed a waiver cannot be merged away underneath it. */
    foreignKey({
      name: "job_lien_waivers_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    /** An order's waivers go with the order. */
    foreignKey({
      name: "job_lien_waivers_commitment_fk",
      columns: [t.tenantId, t.commitmentId],
      foreignColumns: [jobCommitments.tenantId, jobCommitments.id],
    }).onDelete("cascade"),
    /** NO ACTION: the application a waiver names stays; a billed one has no delete verb, and a draft cannot be named. */
    foreignKey({
      name: "job_lien_waivers_application_fk",
      columns: [t.tenantId, t.subApplicationId],
      foreignColumns: [jobSubApplications.tenantId, jobSubApplications.id],
    }),
    check(
      "job_lien_waivers_kind_valid",
      sql`${t.kind} in ('conditional_progress', 'unconditional_progress', 'conditional_final', 'unconditional_final')`,
    ),
    check(
      "job_lien_waivers_status_valid",
      sql`${t.status} in ('requested', 'received', 'void')`,
    ),
    check("job_lien_waivers_amount_nonnegative", sql`${t.amountCents} >= 0`),
    /**
     * Received has the date it arrived and requested has none — the date is
     * the evidence, as a change order's approval date is; a void one keeps
     * whatever it had.
     */
    check(
      "job_lien_waivers_received_has_date",
      sql`(${t.status} = 'requested' and ${t.receivedOn} is null) or (${t.status} = 'received' and ${t.receivedOn} is not null) or ${t.status} = 'void'`,
    ),
  ],
);

export type JobLienWaiver = typeof jobLienWaivers.$inferSelect;
