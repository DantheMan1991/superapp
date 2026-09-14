/**
 * Contracts — the agreements a project is billed against.
 *
 * Part of the `jobs` pack (Layer 2a, P4), in its own file because
 * `src/db/schema/jobs.ts` already carries the project spine and a domain file
 * that holds everything eventually holds nothing findable. The barrel re-exports
 * both, so `@/db/schema` is unchanged.
 *
 * ── A CONTRACT IS A TABLE, NOT A FIELD ──────────────────────────────────────
 *
 * The single most important thing about this file, and the correction that made
 * [ADR 0056](../../docs/decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)
 * worth re-drafting: **a project has MANY contracts over its life, and they are
 * often sequential.** The construction pilot's custom home runs
 *
 *   Concept Design → Construction Drawings → New Home
 *
 * — three agreements, one house, each with its own value and its own way of
 * billing, and **the first two may be the only two that ever exist** because a
 * client can pay for a concept, look at the number and walk. A `contract_type`
 * column on the project could not hold a house that is on its second of three.
 *
 * `sequence` is what keeps the ladder in the order it was agreed, rather than
 * the order the dates happen to fall in — a drawings contract signed late still
 * comes second.
 *
 * ── THERE IS NO `direction` COLUMN, AND THE DOSSIER USED TO SAY THERE WAS ───
 *
 * Every row here is something the business BILLS. What it issues outward — a
 * purchase order, a subcontract to its own trades — is `commitments`, a
 * different table on the cost side (slice 2). `docs/modules/construction.md`
 * said so in prose while also listing a `direction` column, and the prose is
 * right: once commitments are a separate table, direction has nothing left to
 * distinguish.
 *
 * What genuinely varies is `role` — whether the business holds the prime
 * contract with the owner, or a subcontract under somebody else's GC. **Both are
 * billed by the business**; what changes is who the counterparty is and, later,
 * whether retainage is held FROM it. The pilot needs both: its cabinet shop and
 * its excavation division work as subs on other people's jobs.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * **No retainage terms, no schedule of values, no pay applications.** Those are
 * the billing slice, and a column nothing reads is worse than an honest absence
 * — a lesson this pack paid for one slice ago with `PackDefinition
 * .dimensionTypes`. `billing_method` IS here, because it is a term of the
 * agreement recorded when it is signed rather than a mechanic of billing it.
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

export const jobContracts = pgTable(
  "job_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /**
     * The kind of agreement, in the business's own words: `concept_design`,
     * `new_home`, `aia`, `misc_proposal`. Open taxonomy (P1) — format checked,
     * values are not, and the suggestions come from the installed profile. A
     * pack that knew what an AIA contract was would know what industry it was
     * in.
     */
    kind: text("kind").notNull(),
    /** What this one is called, when the kind alone is not enough to tell two apart. */
    name: text("name").notNull().default(""),
    /**
     * Who it is with: the owner on a prime contract, the general contractor on a
     * subcontract. A PARTY, so a client that is also a customer is one row
     * holding two roles.
     *
     * Nullable, because a proposal is written before the other side is a record
     * in the books. No `onDelete`: the CRM's merge deletes the losing identity
     * last precisely so a reference it did not re-point fails on the key and
     * rolls the merge back.
     */
    counterpartyPartyId: uuid("counterparty_party_id"),
    /**
     * **THE AXIS THAT REPLACED `direction`.** `prime` = the business holds the
     * contract with the owner. `subcontract` = it holds a subcontract under
     * somebody else's GC, which is the pilot's cabinet shop and excavation
     * division on other people's jobs. Both are billed by the business.
     */
    role: text("role").notNull().default("prime"),
    /**
     * How this agreement is billed. A CHECK list rather than an open taxonomy,
     * and deliberately so: unlike `kind`, each of these is a different sum, so
     * the pack must actually implement one before it can be offered. Adding a
     * method is a code change and therefore a migration.
     *
     * **SLICE 1 ONLY RECORDS IT.** Nothing bills yet.
     */
    billingMethod: text("billing_method").notNull().default("fixed_price"),
    /**
     * The agreed value, in cents. NULL means "not priced this way", which is
     * different from zero: a cost-plus contract has a fee and no fixed value
     * until it is done.
     */
    valueCents: bigint("value_cents", { mode: "number" }),
    /**
     * text + CHECK, never a pgEnum (documents.md paid for that lesson twice).
     * `proposed` is where the pilot's Concept Design agreement sits before
     * anybody signs; `declined` is the client who looked at the number and
     * walked, which is a real and common end.
     */
    status: text("status").notNull().default("proposed"),
    /**
     * ── THE TERMS OF A COST-PLUS AGREEMENT (slice 5b) ──────────────────────
     *
     * Read only when `billing_method` is `cost_plus_fee`; null on every other
     * contract. A fee is a share of billable cost (`fee_ppm`, 15% = 150,000)
     * OR a fixed sum (`fee_cents`) billed to date by hand on each application
     * — a contract may carry both, which is a fixed fee plus a percentage on
     * cost, an arrangement that exists. `gmax_cents` is the guaranteed
     * maximum: cost plus fee billed to date never passes it. Null means no
     * cap, which is the plain cost-plus case.
     *
     * Not locked when signed, unlike `value_cents`: a GMAX moves by change
     * order in principle, but nothing reports *original + changes = revised*
     * on it yet, so a lock would protect a line nobody reads.
     */
    feePpm: integer("fee_ppm"),
    feeCents: bigint("fee_cents", { mode: "number" }),
    gmaxCents: bigint("gmax_cents", { mode: "number" }),
    /**
     * WHERE IT SITS IN THE LADDER. A project's contracts read in the order they
     * were agreed, not the order their dates fall in — a drawings contract
     * signed late is still the second step.
     */
    sequence: integer("sequence").notNull().default(0),
    signedOn: date("signed_on", { mode: "string" }),
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
    uniqueIndex("job_contracts_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_contracts_tenant_project_idx").on(t.tenantId, t.projectId, t.sequence),
    index("job_contracts_tenant_status_idx").on(t.tenantId, t.status),
    /**
     * Composite FK to `(tenant_id, id)`, so a contract on another tenant's
     * project is UNREPRESENTABLE rather than merely refused by application code.
     * **CASCADE**: a project's contracts are part of the project, and a project
     * that can be deleted takes them with it.
     */
    foreignKey({
      name: "job_contracts_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_contracts_counterparty_fk",
      columns: [t.tenantId, t.counterpartyPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_contracts_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check("job_contracts_role_valid", sql`${t.role} in ('prime', 'subcontract')`),
    check(
      "job_contracts_status_valid",
      sql`${t.status} in ('proposed', 'signed', 'complete', 'declined', 'cancelled')`,
    ),
    check(
      "job_contracts_billing_method_valid",
      sql`${t.billingMethod} in ('fixed_price', 'progress_draw', 'schedule_of_values', 'draw_schedule', 'cost_plus_fee', 'unit_price', 'time_and_materials')`,
    ),
    check(
      "job_contracts_value_nonnegative",
      sql`${t.valueCents} is null or ${t.valueCents} >= 0`,
    ),
    check("job_contracts_sequence_nonnegative", sql`${t.sequence} >= 0`),
    /** A fee rate between nothing and everything; a fixed fee and a cap that are not negative. */
    check(
      "job_contracts_fee_ppm_range",
      sql`${t.feePpm} is null or (${t.feePpm} >= 0 and ${t.feePpm} <= 1000000)`,
    ),
    check("job_contracts_fee_nonnegative", sql`${t.feeCents} is null or ${t.feeCents} >= 0`),
    check("job_contracts_gmax_nonnegative", sql`${t.gmaxCents} is null or ${t.gmaxCents} >= 0`),
  ],
);

export type JobContract = typeof jobContracts.$inferSelect;
