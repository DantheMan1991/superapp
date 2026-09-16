/**
 * Jobs — the project spine, and the cost codes everything is charged to.
 *
 * The `jobs` pack's tables (Layer 2a, P4 in docs/extension-model.md §4),
 * prefixed `job_` the way CRM's are `crm_` and professional services' are `ps_`
 * — the slug spelled out would push index names past what Postgres allows. Same
 * rules as any tenant table: `tenant_id`, FORCE RLS, isolation coverage
 * (tests/isolation/jobs.test.ts).
 *
 * ── WHAT A PROJECT IS, AND THE THREE COORDINATES IT CARRIES ─────────────────
 *
 * A project is a container of work with a cost object. It is the spine every
 * other construction pack hangs off, the way every farm pack hangs off
 * `inventory`'s lot — so it ships first and alone, and the thing that makes it
 * worth anything on day one is the `dimension_members` sync, not the screen:
 * once a project is a cost object, every bill line and every timecard can be
 * tagged to it and every existing accounting report groups by it with no change
 * to accounting at all.
 *
 * The three coordinates are deliberately NOT the delivery method:
 *
 *   entity_id       whose BOOKS the cost lands in (ADR 0010). Required: a cost
 *                   with no set of books to land in is the one thing a project
 *                   must not permit.
 *   enterprise_id   which DIVISION runs it — optional, and a different question
 *                   from the entity. Shrock Premier's Construction, Excavation
 *                   and Cabinet Shop are three enterprises inside ONE entity
 *                   (docs/modules/construction.md).
 *   cost_code_set_id  which list it is budgeted against. NULL means the
 *                   tenant's default set, which is the common case — a business
 *                   with one list must never be asked which.
 *
 * ── THE DELIVERY METHOD IS NULLABLE, AND THAT IS THE POINT ──────────────────
 *
 * [ADR 0056](../../docs/decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md):
 * the flavour of construction is a property of the PROJECT, not the tenant, so
 * a company doing luxury custom, semi-custom and commercial is one ordinary
 * tenant with three kinds of row. It is an open taxonomy (P1) with a format
 * check and no value check, the shape `ps_engagements.kind` already has — a
 * pack that knew what "commercial" meant would know what industry it was in.
 *
 * **NULLABLE because a project may begin before anyone knows what gets built.**
 * The pilot's first contract on a custom home is a Concept Design agreement; the
 * client may look at the number and walk, and that design work is real revenue
 * against a real project either way. Most software in this market requires a
 * build to exist before a job can, which is precisely why pre-construction
 * revenue ends up in a spreadsheet.
 *
 * ── WHY THE COST CODE SET IS A TABLE AND NOT A CONSTANT ─────────────────────
 *
 * Because the range is wide and none of it is ours to choose: CSI MasterFormat
 * is the commercial norm, NAHB's chart the residential one, and plenty of
 * builders use a list they invented — the pilot does, one list across all three
 * of its delivery methods. So a set is tenant-owned data from the moment it
 * exists, and a profile may seed starter sets without owning them afterwards.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { parties } from "./parties";
import { entities } from "./ledger";
import { enterprises } from "./enterprises";

/**
 * A NAMED LIST OF COST CODES. A tenant has one or several.
 *
 * Several is normal for a general contractor working both markets — a
 * CSI-shaped list for commercial, the builder's own for residential — and one
 * is the majority case. `is_default` names the one a project gets when nobody
 * chooses, so the common case needs no decision.
 */
export const jobCostCodeSets = pgTable(
  "job_cost_code_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The set a new project uses when it names none. **At most one per tenant**,
     * enforced by a partial unique index below rather than by application code,
     * because "which list is the default" answered two ways is a budget charged
     * to the wrong chart.
     */
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_cost_code_sets_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_cost_code_sets_tenant_name_idx").on(t.tenantId, t.name),
    /**
     * ONE DEFAULT, OR NONE. A partial unique index, so setting a second default
     * fails at the database rather than depending on the action having cleared
     * the first one.
     */
    uniqueIndex("job_cost_code_sets_one_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
    check(
      "job_cost_code_sets_name_present",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * ONE LINE OF THE CHART OF COST.
 *
 * `code` is free text and not a number: CSI writes `03 30 00`, NAHB writes
 * `1000`, and a builder's own list writes `CONC-SLAB`. Nothing here parses it;
 * `sort_order` is what puts the list in the order the business reads it, so the
 * code never has to be sortable to be right.
 */
export const jobCostCodes = pgTable(
  "job_cost_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    setId: uuid("set_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_cost_codes_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * Composite FK to `(tenant_id, id)`, so a code in another tenant's set is
     * UNREPRESENTABLE rather than merely refused by application code — it fails
     * even under `withSystem`, where RLS is not watching. Cascade, unlike the
     * enterprise FK below: deleting a set is deleting its codes, and a set with
     * a budget against it is refused a layer up rather than here.
     */
    foreignKey({
      name: "job_cost_codes_set_fk",
      columns: [t.tenantId, t.setId],
      foreignColumns: [jobCostCodeSets.tenantId, jobCostCodeSets.id],
    }).onDelete("cascade"),
    /** One code per set. Two `03 30 00`s is a chart nobody can post against. */
    uniqueIndex("job_cost_codes_set_code_idx").on(t.tenantId, t.setId, t.code),
    index("job_cost_codes_tenant_set_sort_idx").on(t.tenantId, t.setId, t.sortOrder),
    check("job_cost_codes_code_present", sql`length(btrim(${t.code})) > 0`),
    check("job_cost_codes_name_present", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const jobProjects = pgTable(
  "job_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * WHOSE BOOKS. Required, and the one coordinate that is: a project is a
     * cost object, and a cost with no set of books to land in is what ADR 0010
     * exists to prevent. Every tenant has at least one entity, and the picker
     * only appears at two — so requiring it costs a single-company business
     * nothing.
     */
    entityId: uuid("entity_id").notNull(),
    /**
     * WHICH DIVISION runs it. Optional, and a DIFFERENT question from the
     * entity: the pilot's Construction, Excavation and Cabinet Shop are three
     * enterprises inside one LLC, so the trial balance does not have to balance
     * within one. Composite FK with no `onDelete`, i.e. RESTRICT, for the
     * reason `inventory_items.enterprise_id` gives: an enterprise is archived
     * and never deleted, so a delete reaching this FK is a mistake worth
     * stopping.
     */
    enterpriseId: uuid("enterprise_id"),
    /**
     * The client, as a PARTY — the shared identity Accounting and CRM already
     * keep, so a project never carries a name of its own for the client and a
     * party that is also a customer is one row holding two roles.
     *
     * Nullable, because a speculative build has no client until it sells. No
     * `onDelete`: the CRM's merge deletes the losing identity last precisely so
     * a reference it did not know to re-point fails on the key and rolls the
     * merge back, rather than taking somebody's project with it.
     */
    partyId: uuid("party_id"),
    /** The job number, in whatever form the business writes it. */
    number: text("number").notNull(),
    name: text("name").notNull(),
    /**
     * text + CHECK, never a pgEnum (documents.md paid for that lesson twice).
     * `planned` is where a project that is only a design agreement sits.
     */
    status: text("status").notNull().default("planned"),
    /**
     * **ADR 0056.** Open taxonomy (P1): format checked, values are not, and
     * NULLABLE because a project may exist before anyone knows what gets built.
     * A pack must never branch on this — it is data a project TEMPLATE reads,
     * and a pack that said `if (deliveryMethod === "commercial")` would have
     * re-created the industry branch with a new spelling.
     */
    deliveryMethod: text("delivery_method"),
    /** NULL means the tenant's default set. See the file header. */
    costCodeSetId: uuid("cost_code_set_id"),
    /** Where the work is. Blank for work that happens nowhere in particular. */
    address: text("address").notNull().default(""),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    /**
     * THE WARRANTY PERIOD (ADR 0076): how many months the business warrants
     * its work, from the day of substantial completion. Both null until
     * somebody sets them; the expiry is DERIVED (`warrantyExpiresOn`), never
     * stored. One period per job, the general warranty; a longer structural
     * or systems tier is a refinement nobody has asked for.
     */
    warrantyMonths: integer("warranty_months"),
    substantialCompletionOn: date("substantial_completion_on", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    /** P2 extension bag: `NOT NULL DEFAULT '{}'` so `metadata->>'x'` is always safe. */
    metadata: jsonb("metadata").notNull().default({}),
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
    uniqueIndex("job_projects_tenant_id_id_idx").on(t.tenantId, t.id),
    /** A job number is how people refer to the thing out loud. One each. */
    uniqueIndex("job_projects_tenant_number_idx").on(t.tenantId, t.number),
    index("job_projects_tenant_status_idx").on(t.tenantId, t.status),
    index("job_projects_tenant_entity_idx").on(t.tenantId, t.entityId),
    index("job_projects_tenant_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "job_projects_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    foreignKey({
      name: "job_projects_enterprise_fk",
      columns: [t.tenantId, t.enterpriseId],
      foreignColumns: [enterprises.tenantId, enterprises.id],
    }),
    foreignKey({
      name: "job_projects_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    foreignKey({
      name: "job_projects_cost_code_set_fk",
      columns: [t.tenantId, t.costCodeSetId],
      foreignColumns: [jobCostCodeSets.tenantId, jobCostCodeSets.id],
    }),
    check("job_projects_number_present", sql`length(btrim(${t.number})) > 0`),
    /** `coalesce`, because a CHECK that evaluates to NULL passes (migration 0366 paid for that). */
    check("job_projects_warranty_months_whole", sql`coalesce(${t.warrantyMonths}, 1) between 1 and 1200`),
    check("job_projects_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "job_projects_status_valid",
      sql`${t.status} in ('planned', 'active', 'on_hold', 'complete', 'cancelled')`,
    ),
    /** Format only. A business with a fifth kind of work types it. */
    check(
      "job_projects_delivery_method_format",
      sql`${t.deliveryMethod} is null or ${t.deliveryMethod} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "job_projects_dates_ordered",
      sql`${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
  ],
);

export type JobCostCodeSet = typeof jobCostCodeSets.$inferSelect;
export type JobCostCode = typeof jobCostCodes.$inferSelect;
export type JobProject = typeof jobProjects.$inferSelect;
