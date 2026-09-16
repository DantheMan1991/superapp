import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobCostCodes, jobProjects } from "./jobs";
import { jobContracts } from "./jobs-contracts";
import { entities } from "./ledger";
import { parties } from "./parties";
import { tenants } from "./platform";

/**
 * Surety bonds, and the line the surety gives the business (ADR 0078).
 *
 * ── TWO TABLES, BECAUSE THEY ANSWER TWO QUESTIONS ───────────────────────────
 *
 * `job_bonds` is the RECORD: which job is bonded, by whom, for how much,
 * what it cost and when it runs out. `job_bonding_lines` is the CAPACITY:
 * how much work this company's surety will back at once. The second is what
 * a contractor actually opens the screen for — *can I bid this one* — and it
 * cannot be answered from the bonds alone, because the limits live in the
 * surety's letter and nowhere in the books.
 *
 * ── A BOND IS ON THE JOB, AND NAMES A CONTRACT WHEN THERE IS ONE ────────────
 *
 * A performance or payment bond is against a contract; a BID bond exists
 * before any contract does, which is its whole purpose. Rather than two
 * nullable parents and a CHECK to keep them honest, the bond hangs off the
 * PROJECT and names `contract_id` when it has one. Always representable, and
 * the capacity arithmetic reads the job's backlog either way — which is what
 * a surety means by work on hand.
 *
 * ── THE KIND IS THE BUSINESS'S ──────────────────────────────────────────────
 *
 * Open taxonomy with a format check, as a contract's kind and a party
 * document's kind are. Bid, performance, payment and maintenance are the
 * four everybody writes; a residential developer also posts a subdivision
 * bond with the municipality, and a supplier may want a supply bond. A pack
 * that enumerated them would be guessing at somebody's state. The one thing
 * the pack does with a bond is read `expires_on` and count the job once.
 */
export const jobBonds = pgTable(
  "job_bonds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The obligation, when it is a contract. Null on a bid bond, which comes first. */
    contractId: uuid("contract_id"),
    /** `bid` | `performance` | `payment` | `maintenance` | whatever the business posts. */
    kind: text("kind").notNull(),
    /** The surety's own bond number, in whatever form they write it. */
    number: text("number").notNull().default(""),
    /** The surety company, as a PARTY — the shared identity the books already keep. */
    suretyPartyId: uuid("surety_party_id"),
    /** What the bond covers. Usually the contract sum on a performance bond. */
    penalSumCents: bigint("penal_sum_cents", { mode: "number" }).notNull(),
    /**
     * What the bond COST. Recorded, never posted: the surety's invoice is an
     * ordinary bill in Accounting, and the code below is where it belongs on
     * the job so the cost report shows it beside everything else.
     */
    premiumCents: bigint("premium_cents", { mode: "number" }),
    costCodeId: uuid("cost_code_id"),
    /** The day it took effect, and the day it runs out. Many bonds have no expiry and are released instead. */
    effectiveOn: date("effective_on", { mode: "string" }),
    expiresOn: date("expires_on", { mode: "string" }),
    releasedOn: date("released_on", { mode: "string" }),
    /** `requested` | `issued` | `released` | `void`. Where it STANDS is derived against today. */
    status: text("status").notNull().default("requested"),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_bonds_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_bonds_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_bonds_tenant_contract_idx").on(t.tenantId, t.contractId),
    index("job_bonds_tenant_surety_idx").on(t.tenantId, t.suretyPartyId),
    foreignKey({
      name: "job_bonds_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("contract_id")`: a bare
    // SET NULL would try to null tenant_id too and can never run on a composite key. A contract gone
    // leaves the bond on the job, which is where the surety thinks it is.
    foreignKey({
      name: "job_bonds_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }).onDelete("set null"),
    // The same column-list SET NULL: a code retired leaves what the bond cost.
    foreignKey({
      name: "job_bonds_cost_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }).onDelete("set null"),
    // No `onDelete`, as every party key in the pack: the CRM's merge deletes the losing identity last
    // so a reference it did not re-point fails here and rolls the merge back.
    foreignKey({
      name: "job_bonds_surety_fk",
      columns: [t.tenantId, t.suretyPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_bonds_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check("job_bonds_penal_sum_positive", sql`${t.penalSumCents} > 0`),
    /** `coalesce`, because a CHECK that evaluates to NULL passes (migration 0366 paid for that). */
    check("job_bonds_premium_nonnegative", sql`coalesce(${t.premiumCents}, 0) >= 0`),
    check("job_bonds_status_valid", sql`${t.status} in ('requested', 'issued', 'released', 'void')`),
    /** A bond that is or has been in force carries the day it took effect. */
    check("job_bonds_in_force_dated", sql`${t.status} in ('requested', 'void') or ${t.effectiveOn} is not null`),
    /** A released bond carries the day it was released, and only a released one does. */
    check("job_bonds_released_dated", sql`(${t.status} = 'released') = (${t.releasedOn} is not null)`),
    check("job_bonds_expiry_after_effective", sql`${t.expiresOn} is null or ${t.effectiveOn} is null or ${t.expiresOn} >= ${t.effectiveOn}`),
    check("job_bonds_number_bounded", sql`char_length(${t.number}) <= 100`),
    check("job_bonds_notes_bounded", sql`char_length(${t.notes}) <= 4000`),
  ],
);

/**
 * What one company's surety will back. ONE ROW PER COMPANY, because a surety
 * underwrites a legal entity and a tenant may hold several — the same axis
 * the WIP schedule is picked on.
 *
 * Both limits are nullable: a business that knows its aggregate and has
 * never been told a single-job number is the common case, and half a line is
 * worth more than none.
 */
export const jobBondingLines = pgTable(
  "job_bonding_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").notNull(),
    /** The biggest single job the surety will bond. */
    singleJobLimitCents: bigint("single_job_limit_cents", { mode: "number" }),
    /** The most work on hand they will back at once. */
    aggregateLimitCents: bigint("aggregate_limit_cents", { mode: "number" }),
    suretyPartyId: uuid("surety_party_id"),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_bonding_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One line per company. */
    uniqueIndex("job_bonding_lines_entity_idx").on(t.tenantId, t.entityId),
    foreignKey({
      name: "job_bonding_lines_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    foreignKey({
      name: "job_bonding_lines_surety_fk",
      columns: [t.tenantId, t.suretyPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_bonding_lines_single_positive", sql`coalesce(${t.singleJobLimitCents}, 1) > 0`),
    check("job_bonding_lines_aggregate_positive", sql`coalesce(${t.aggregateLimitCents}, 1) > 0`),
    /** A single-job limit above the aggregate is a typo, not a line. */
    check(
      "job_bonding_lines_single_within_aggregate",
      sql`${t.singleJobLimitCents} is null or ${t.aggregateLimitCents} is null or ${t.singleJobLimitCents} <= ${t.aggregateLimitCents}`,
    ),
    check("job_bonding_lines_notes_bounded", sql`char_length(${t.notes}) <= 4000`),
  ],
);

export type JobBond = typeof jobBonds.$inferSelect;
export type NewJobBond = typeof jobBonds.$inferInsert;
export type JobBondingLine = typeof jobBondingLines.$inferSelect;
