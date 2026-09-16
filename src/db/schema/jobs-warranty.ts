import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobCostCodes, jobProjects } from "./jobs";
import { parties } from "./parties";
import { tenants } from "./platform";
import { workItems } from "./work";

/**
 * A warranty claim (ADR 0076): the call that comes after the job is done —
 * what is wrong, where, who reported it and when, the trade the business
 * thinks is responsible, and the decision whether the warranty covers it.
 *
 * THE WORK IS A WORK ITEM. Recording a claim raises an ordinary Work item
 * linked to the claim — the row the daily digest chases and the Work module
 * assigns and dates — and the claim remembers it in `work_item_id`, the way
 * a pin remembers its punch item (ADR 0073). Where the claim stands is
 * derived from the two: not covered by decision; otherwise done, scheduled
 * or open by the work item. The key to `work_items` SETS NULL (column-list
 * form, the mail_links precedent) rather than cascading: a work item cleared
 * from Work leaves the claim as the record of the call, and the pack can
 * raise the work again.
 *
 * THE MONEY IS THE JOB'S. A claim names a cost code — the business's own
 * warranty code, whatever it calls it — and the job cost report already
 * shows what was spent under it; nothing here is a second ledger. The code
 * is a hint, not a rule: a claim with none is a claim whose cost the office
 * codes when the bill arrives.
 *
 * THE PERIOD IS ON THE JOB (`job_projects.warranty_months` and
 * `substantial_completion_on`); a claim reported outside it is recorded and
 * says so, never refused — the builder decides what the warranty covers.
 */
export const jobWarrantyClaims = pgTable(
  "job_warranty_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** 1, 2, 3… per job, in the order recorded: how the claim is referred to out loud. */
    number: integer("number").notNull(),
    /** What is wrong, in the reporter's words. */
    title: text("title").notNull(),
    /** Where on the job: "master bath", "north gable", blank when it is the whole thing. */
    location: text("location").notNull().default(""),
    reportedOn: date("reported_on", { mode: "string" }).notNull(),
    /** Who called it in — the owner, the tenant, the property manager — as a name. */
    reportedBy: text("reported_by").notNull().default(""),
    /** The trade the business holds responsible, while one is named. A PARTY, so the subcontractor on the job's order is the same row. */
    partyId: uuid("party_id"),
    /** The cost code the fix is charged under, so the job cost report shows the warranty spend by name. */
    costCodeId: uuid("cost_code_id"),
    /** pending | covered | not_covered — `WARRANTY_DECISIONS`. */
    decision: text("decision").notNull().default("pending"),
    /** Why, in one line: "owner damage", "outside the period, fixed as goodwill". */
    decisionNote: text("decision_note").notNull().default(""),
    decidedOn: date("decided_on", { mode: "string" }),
    /** The Work item raised for the claim, while it exists. */
    workItemId: uuid("work_item_id"),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_warranty_claims_tenant_id_id_idx").on(t.tenantId, t.id),
    /** A number is once per job. */
    uniqueIndex("job_warranty_claims_number_idx").on(t.tenantId, t.projectId, t.number),
    index("job_warranty_claims_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_warranty_claims_tenant_work_idx").on(t.tenantId, t.workItemId),
    index("job_warranty_claims_tenant_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "job_warranty_claims_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    // No `onDelete`, as every party key in the pack: the CRM's merge deletes the losing identity last so a
    // reference it did not re-point fails here and rolls the merge back.
    foreignKey({
      name: "job_warranty_claims_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("cost_code_id")`: a bare
    // SET NULL would try to null tenant_id too and can never run on a composite key. A code removed leaves the claim.
    foreignKey({
      name: "job_warranty_claims_cost_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }).onDelete("set null"),
    // The same column-list SET NULL: a work item cleared from Work leaves the claim as the record of the call.
    foreignKey({
      name: "job_warranty_claims_work_fk",
      columns: [t.tenantId, t.workItemId],
      foreignColumns: [workItems.tenantId, workItems.id],
    }).onDelete("set null"),
    check("job_warranty_claims_number_positive", sql`${t.number} > 0`),
    check("job_warranty_claims_title_present", sql`length(btrim(${t.title})) > 0`),
    check("job_warranty_claims_decision_valid", sql`${t.decision} in ('pending', 'covered', 'not_covered')`),
    /** A decision carries the day it was made, and only a decision does. */
    check("job_warranty_claims_decision_dated", sql`(${t.decision} = 'pending') = (${t.decidedOn} is null)`),
    check("job_warranty_claims_title_bounded", sql`char_length(${t.title}) <= 300`),
    check("job_warranty_claims_location_bounded", sql`char_length(${t.location}) <= 300`),
    check("job_warranty_claims_reported_by_bounded", sql`char_length(${t.reportedBy}) <= 200`),
    check("job_warranty_claims_decision_note_bounded", sql`char_length(${t.decisionNote}) <= 2000`),
    check("job_warranty_claims_notes_bounded", sql`char_length(${t.notes}) <= 4000`),
  ],
);

export type JobWarrantyClaim = typeof jobWarrantyClaims.$inferSelect;
export type NewJobWarrantyClaim = typeof jobWarrantyClaims.$inferInsert;
